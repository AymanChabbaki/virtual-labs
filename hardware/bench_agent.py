#!/usr/bin/env python3
"""
Agent de banc d'essai (Raspberry Pi / PC / Arduino via port série) pour la plateforme « TP Virtuels & à Distance ».
وكيل الجهاز الحقيقي: يستقبل الأوامر من الخادم عبر MQTT ويبث القياسات.

Contrat MQTT (voir backend/src/remote/types.ts et mqttDevice.ts)
  labs/<topic>/cmd        serveur -> appareil  {"id":1,"name":"set_voltage","params":{"value":5.0}}
       name ∈ set_voltage | select_load | switch | reset | emergency_stop
  labs/<topic>/telemetry  appareil -> serveur  ~10 Hz  {voltage,current,vLoad,power,temp,tSwitch,switchOn,setpoint,load,tripped,estop}
  labs/<topic>/status     appareil -> serveur  "online" (retained) ; "offline" via Last-Will si la connexion tombe

⚠️  État du code : implémentation de RÉFÉRENCE. Elle a été testée avec le broker MQTT de test du projet
    et le matériel SIMULÉ ci-dessous (voir `SimulatedHardware`). Elle n'a PAS été testée sur du matériel réel :
    `RaspberryPiHardware` est un squelette à adapter à VOTRE carte (ADC, relais, alimentation programmable).

Sécurité (défense en profondeur) : le serveur valide déjà chaque commande, mais l'appareil applique AUSSI
ses propres limites locales (LIMITS) et se met en état sûr (0 V, sortie coupée) si :
  - un courant/une température dépasse le seuil (auto-déclenchement « trip »),
  - l'arrêt d'urgence est demandé,
  - la connexion MQTT est perdue (on_disconnect).
Ajoutez toujours une protection MATÉRIELLE indépendante (fusible, limitation de courant de l'alimentation).

Usage :
  pip install paho-mqtt
  python3 bench_agent.py --host localhost --port 1883 --topic bench-01            # matériel simulé
  python3 bench_agent.py --host broker.local --topic bench-01 --hardware rpi       # après adaptation de RaspberryPiHardware
"""
import argparse
import json
import math
import random
import signal
import sys
import threading
import time

import paho.mqtt.client as mqtt

# ----------------------------------------------------------------------------- limites locales (indépendantes du serveur)
LIMITS = {"v_max": 12.0, "i_max_ma": 150.0, "temp_max": 70.0}
LOADS = ("NONE", "R100", "R220", "R470", "RC", "DIODE")
TICK = 0.1  # 10 Hz


# ----------------------------------------------------------------------------- couche matériel
class Hardware:
    """Interface à implémenter pour un vrai banc. Toutes les grandeurs en V, mA, °C."""

    def set_voltage(self, v: float): ...
    def set_output(self, on: bool): ...
    def select_load(self, load: str): ...
    def read(self) -> dict:
        """Retourne {'voltage','current','vLoad','temp'} mesurés (ADC)."""
        raise NotImplementedError

    def safe_state(self):
        self.set_output(False)
        self.set_voltage(0.0)


class SimulatedHardware(Hardware):
    """Banc simulé (même physique que l'appareil « mock » du serveur) : sert à tester le câblage MQTT sans matériel."""

    R = {"R100": 100.0, "R220": 220.0, "R470": 470.0}
    RC_R, RC_C = 4700.0, 470e-6
    D_RS, D_IS, D_NVT = 220.0, 1e-9, 0.0465

    def __init__(self):
        self.sp, self.out, self.load = 0.0, False, "NONE"
        self.uc, self.temp = 0.0, 25.0
        self._i = 0.0
        self._vd = 0.0

    def set_voltage(self, v): self.sp = v
    def set_output(self, on): self.out = on
    def select_load(self, load):
        self.load, self.uc = load, 0.0

    def _diode(self, vs):
        lo, hi = 0.0, max(vs, 0.0)
        for _ in range(50):
            mid = (lo + hi) / 2
            f = mid + self.D_RS * self.D_IS * (math.exp(mid / self.D_NVT) - 1) - vs
            lo, hi = (lo, mid) if f > 0 else (mid, hi)
        vd = (lo + hi) / 2
        return vd, self.D_IS * (math.exp(vd / self.D_NVT) - 1)

    def read(self):
        vs = self.sp if self.out else 0.0
        if self.load in self.R:
            i = vs / self.R[self.load]; vload = vs
        elif self.load == "RC":
            i = (vs - self.uc) / self.RC_R
            self.uc += i * TICK / self.RC_C
            vload = self.uc
        elif self.load == "DIODE":
            vload, i = self._diode(vs)
        else:
            i, vload = 0.0, 0.0
        p_mw = abs(vs * i) * 1000
        self.temp += (25 + p_mw * 0.15 - self.temp) * 0.02
        n = lambda s: random.gauss(0, s)
        return {"voltage": vs + n(0.003), "current": i * 1000 + n(0.05), "vLoad": vload + n(0.003), "temp": self.temp + n(0.05)}


class RaspberryPiHardware(Hardware):
    """SQUELETTE À ADAPTER (non testé sur matériel réel).
    Exemple de matériel : alimentation programmable via DAC MCP4725 (I2C), ADC ADS1115 (I2C) pour U/I/Uc,
    relais (GPIO) pour la sortie et pour chaque charge, capteur DS18B20 pour la température.
    Bibliothèques possibles : gpiozero, smbus2, adafruit-circuitpython-ads1x15.
    """

    def __init__(self):
        raise NotImplementedError("Adaptez RaspberryPiHardware à votre carte (voir commentaires du fichier).")


# ----------------------------------------------------------------------------- agent
class Agent:
    def __init__(self, hw: Hardware, topic: str):
        self.hw, self.topic = hw, topic
        self.lock = threading.Lock()
        self.setpoint, self.out, self.load = 0.0, False, "NONE"
        self.estop, self.tripped = False, False
        self.t_switch_ref = time.time()
        self.stop = threading.Event()

    # ---- commandes (déjà validées côté serveur, re-validées ici)
    def handle(self, cmd: dict):
        name, p = cmd.get("name"), cmd.get("params") or {}
        with self.lock:
            if name == "emergency_stop":
                self.estop = True
                self._safe()
            elif name == "reset":
                self.estop = self.tripped = False
                self._safe()
            elif self.estop or self.tripped:
                return  # verrou : seule la commande reset est acceptée
            elif name == "set_voltage":
                v = float(p.get("value", -1))
                if 0 <= v <= LIMITS["v_max"]:
                    self.setpoint = v
                    self.hw.set_voltage(v)
            elif name == "select_load":
                load = p.get("load")
                if load in LOADS and not self.out:  # changement de charge uniquement sortie coupée
                    self.load = load
                    self.hw.select_load(load)
            elif name == "switch":
                on = p.get("state") == "on"
                if on != self.out:
                    self.out, self.t_switch_ref = on, time.time()
                    self.hw.set_output(on)

    def _safe(self):
        self.setpoint, self.out = 0.0, False
        self.hw.safe_state()

    # ---- boucle de mesure / télémétrie
    def loop(self, client: mqtt.Client):
        while not self.stop.is_set():
            t0 = time.time()
            with self.lock:
                m = self.hw.read()
                if not self.tripped and (abs(m["current"]) > LIMITS["i_max_ma"] or m["temp"] > LIMITS["temp_max"]):
                    self.tripped = True
                    self._safe()
                    print("[agent] TRIP: dépassement de limite locale", m)
                tele = {
                    "voltage": round(m["voltage"], 4), "current": round(m["current"], 4), "vLoad": round(m["vLoad"], 4),
                    "power": round(abs(m["voltage"] * m["current"]), 3), "temp": round(m["temp"], 2),
                    "tSwitch": round(time.time() - self.t_switch_ref, 2), "switchOn": self.out,
                    "setpoint": self.setpoint, "load": self.load, "tripped": self.tripped, "estop": self.estop,
                }
            client.publish(f"labs/{self.topic}/telemetry", json.dumps(tele), qos=0)
            time.sleep(max(0.0, TICK - (time.time() - t0)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--topic", default="bench-mock", help="doit correspondre au champ « topic » de l'appareil dans l'administration")
    ap.add_argument("--user", default=None)
    ap.add_argument("--password", default=None)
    ap.add_argument("--hardware", choices=["sim", "rpi"], default="sim")
    a = ap.parse_args()

    agent = Agent(SimulatedHardware() if a.hardware == "sim" else RaspberryPiHardware(), a.topic)
    try:  # paho-mqtt >= 2.0 exige la version d'API ; 1.x ne l'accepte pas
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"bench-agent-{a.topic}")
    except AttributeError:
        client = mqtt.Client(client_id=f"bench-agent-{a.topic}")
    if a.user:
        client.username_pw_set(a.user, a.password)
    client.will_set(f"labs/{a.topic}/status", "offline", qos=1, retain=True)

    def on_connect(c, *_):
        c.subscribe(f"labs/{a.topic}/cmd", qos=1)
        c.publish(f"labs/{a.topic}/status", "online", qos=1, retain=True)
        print(f"[agent] connecté — labs/{a.topic}/#  (matériel: {a.hardware})")

    def on_disconnect(*_):
        with agent.lock:  # connexion perdue : état sûr
            agent._safe()
        print("[agent] connexion perdue → état sûr")

    def on_message(_c, _u, msg):
        try:
            agent.handle(json.loads(msg.payload))
        except Exception as e:  # message malformé : ignoré
            print("[agent] commande ignorée:", e)

    client.on_connect, client.on_disconnect, client.on_message = on_connect, on_disconnect, on_message
    client.connect(a.host, a.port, keepalive=10)
    client.loop_start()

    def bye(*_):
        agent.stop.set()
    signal.signal(signal.SIGINT, bye)
    signal.signal(signal.SIGTERM, bye)
    agent.loop(client)
    with agent.lock:
        agent._safe()
    client.publish(f"labs/{a.topic}/status", "offline", qos=1, retain=True).wait_for_publish(2)
    client.loop_stop()
    client.disconnect()
    sys.exit(0)


if __name__ == "__main__":
    main()
