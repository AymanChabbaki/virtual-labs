"use client";
// إدارة الفصول الدراسية (مدير)
import { useState } from "react";
import useSWR from "swr";
import { Button, Card, Empty, PageLoader, useUx } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { useI18n } from "@/i18n";

interface C {
  id: string;
  name: string;
  _count: { students: number };
}

export default function ClassroomsPage() {
  const { t } = useI18n();
  const ux = useUx();
  const { data, mutate } = useSWR<{ classrooms: C[] }>("/admin/classrooms", fetcher);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  if (!data) return <PageLoader />;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await mutate();
    } catch (e) {
      ux.error(e);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-5 text-2xl font-semibold">{t("nav.classrooms")}</h1>
      <form
        className="mb-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run(async () => (await api("/admin/classrooms", { method: "POST", body: { name: name.trim() } }), setName("")));
        }}
      >
        <input className="input" placeholder={t("admin.classroom_name")} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit">+ {t("common.add")}</Button>
      </form>
      {!data.classrooms.length ? (
        <Empty>{t("admin.no_classrooms")}</Empty>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {data.classrooms.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                {editing?.id === c.id ? (
                  <>
                    <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
                    <Button size="sm" onClick={() => run(async () => (await api(`/admin/classrooms/${c.id}`, { method: "PATCH", body: { name: editing.name } }), setEditing(null)))}>
                      {t("common.save")}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 font-medium">{c.name}</span>
                    <span className="num text-sm text-ink-3">{t("admin.students_n", { n: c._count.students })}</span>
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ id: c.id, name: c.name })}>
                      {t("common.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={async () => (await ux.confirm(t("admin.classroom_delete_confirm", { name: c.name }), { danger: true })) && run(() => api(`/admin/classrooms/${c.id}`, { method: "DELETE" }))}
                    >
                      ✕
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
