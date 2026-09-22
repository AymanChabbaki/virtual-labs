"use client";
// إدارة المستخدمين (مدير): إنشاء، تعديل الدور/الفصل، تعطيل، إعادة تعيين كلمة المرور
import { useState } from "react";
import useSWR from "swr";
import { Badge, Button, Card, Field, Modal, PageLoader, useUx } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/i18n";
import type { Role } from "@/lib/types";

interface U {
  id: string;
  name: string;
  email: string;
  role: Role;
  locale: "ar" | "fr";
  active: boolean;
  classroom: string | null;
  classroomId: string | null;
}
const empty = { id: "", name: "", email: "", role: "STUDENT" as Role, locale: "fr" as "fr" | "ar", classroomId: "", password: "", active: true };

export default function UsersPage() {
  const { t } = useI18n();
  const ux = useUx();
  const { user: me } = useAuth();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const { data, mutate } = useSWR<{ users: U[] }>(`/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(role ? { role } : {}) })}`, fetcher);
  const { data: cls } = useSWR<{ classrooms: { id: string; name: string }[] }>("/admin/classrooms", fetcher);
  const [edit, setEdit] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: edit.name, email: edit.email, role: edit.role, locale: edit.locale, classroomId: edit.role === "STUDENT" ? edit.classroomId || null : null };
      if (edit.password) body.password = edit.password;
      if (edit.id) await api(`/admin/users/${edit.id}`, { method: "PATCH", body: { ...body, active: edit.active } });
      else await api("/admin/users", { method: "POST", body });
      setEdit(null);
      await mutate();
    } catch (e) {
      ux.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (u: U) => {
    if (!(await ux.confirm(t("admin.user_delete_confirm", { name: u.name }), { danger: true }))) return;
    try {
      await api(`/admin/users/${u.id}`, { method: "DELETE" });
      await mutate();
    } catch (e) {
      ux.error(e);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("nav.users")}</h1>
        <Button onClick={() => setEdit({ ...empty })}>+ {t("admin.new_user")}</Button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-44" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{t("common.all")}</option>
          {(["STUDENT", "TEACHER", "ADMIN"] as Role[]).map((r) => (
            <option key={r} value={r}>
              {t(`role.${r}`)}
            </option>
          ))}
        </select>
      </div>
      {!data ? (
        <PageLoader />
      ) : (
        <Card className="scroll-x p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-ink-3">
              <tr>
                {["admin.col.name", "admin.col.email", "admin.col.role", "admin.col.classroom", "admin.col.status"].map((k) => (
                  <th key={k} className="px-3 py-3 text-start font-medium">
                    {t(k)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-3 py-2.5 font-medium">{u.name}</td>
                  <td className="px-3 py-2.5 text-ink-2" dir="ltr">
                    {u.email}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.role === "ADMIN" ? "red" : u.role === "TEACHER" ? "amber" : "blue"}>{t(`role.${u.role}`)}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{u.classroom ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.active ? "green" : "slate"}>{u.active ? t("admin.active") : t("admin.inactive")}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-end">
                    <Button size="sm" variant="secondary" onClick={() => setEdit({ id: u.id, name: u.name, email: u.email, role: u.role, locale: u.locale, classroomId: u.classroomId ?? "", password: "", active: u.active })}>
                      {t("common.edit")}
                    </Button>
                    {u.id !== me?.id && (
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(u)}>
                        ✕
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t("common.edit") : t("admin.new_user")}>
        {edit && (
          <div className="space-y-3">
            <Field label={t("admin.col.name")}>
              <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label={t("admin.col.email")}>
              <input className="input" type="email" dir="ltr" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("admin.col.role")}>
                <select className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>
                  {(["STUDENT", "TEACHER", "ADMIN"] as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {t(`role.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("profile.language")}>
                <select className="input" value={edit.locale} onChange={(e) => setEdit({ ...edit, locale: e.target.value as "fr" | "ar" })}>
                  <option value="fr">Français</option>
                  <option value="ar">العربية</option>
                </select>
              </Field>
            </div>
            {edit.role === "STUDENT" && (
              <Field label={t("admin.col.classroom")}>
                <select className="input" value={edit.classroomId} onChange={(e) => setEdit({ ...edit, classroomId: e.target.value })}>
                  <option value="">—</option>
                  {cls?.classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={edit.id ? t("admin.reset_pw") : t("profile.new_pw")} hint={t("profile.pw_hint")}>
              <input className="input" type="text" dir="ltr" autoComplete="off" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </Field>
            {edit.id && edit.id !== me?.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
                {t("admin.active")}
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>
                {t("common.cancel")}
              </Button>
              <Button loading={busy} onClick={save} disabled={!edit.name || !edit.email || (!edit.id && edit.password.length < 8)}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
