"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  overviewTodoDueDate,
  type OverviewAutoTodo,
} from "@/lib/overview-todos";
import { todayDateInputValue } from "@/lib/utils";

type StoredTodo = {
  id: string;
  task: string;
  dueDate: string;
  done: boolean;
  note: string;
  sourceKey: string | null;
};

const STORAGE_KEY = "maison-joy-overview-todos";

function loadStored(): StoredTodo[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredTodo[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.task === "string")
      .map((item) => ({
        ...item,
        note: typeof item.note === "string" ? item.note : "",
      }));
  } catch {
    return [];
  }
}

function saveStored(items: StoredTodo[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function mergeAutoTodos(stored: StoredTodo[], autoTodos: OverviewAutoTodo[]) {
  const autoKeys = new Set(autoTodos.map((item) => item.sourceKey));
  const next = stored.filter(
    (item) => item.sourceKey == null || autoKeys.has(item.sourceKey)
  );

  for (const auto of autoTodos) {
    const existing = next.find((item) => item.sourceKey === auto.sourceKey);
    if (existing) {
      existing.task = auto.task;
      if (auto.dueDate) existing.dueDate = auto.dueDate;
      continue;
    }
    next.push({
      id: crypto.randomUUID(),
      task: auto.task,
      dueDate: auto.dueDate || overviewTodoDueDate(),
      done: false,
      note: "",
      sourceKey: auto.sourceKey,
    });
  }

  return next;
}

function TodoNote({
  note,
  task,
  onSave,
}: {
  note: string;
  task: string;
  onSave: (note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const skipSave = useRef(false);

  function startEditing() {
    setDraft(note);
    setEditing(true);
  }

  function finish(save: boolean) {
    if (save && !skipSave.current) onSave(draft.trim());
    skipSave.current = false;
    setEditing(false);
  }

  if (editing) {
    return (
      <textarea
        value={draft}
        autoFocus
        rows={2}
        aria-label={`Note for ${task}`}
        placeholder="Add a note"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            skipSave.current = true;
            finish(false);
          }
        }}
        className="mt-1 w-full resize-y rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
      />
    );
  }

  if (note) {
    return (
      <div className="mt-1">
        <p className="whitespace-pre-wrap text-xs text-slate-500">{note}</p>
        <button
          type="button"
          onClick={startEditing}
          className="mt-1 block text-left text-xs font-medium text-brand-700 hover:underline"
        >
          Edit Note
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
        className="mt-1 block text-left text-xs font-medium text-brand-700 hover:underline"
    >
      Add note
    </button>
  );
}

export function OverviewTodoList({ autoTodos }: { autoTodos: OverviewAutoTodo[] }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [todos, setTodos] = useState<StoredTodo[]>([]);
  const [ready, setReady] = useState(false);
  const [task, setTask] = useState("");
  const [dueDate, setDueDate] = useState(overviewTodoDueDate);
  const rows = useMemo(
    () =>
      [...todos].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return a.task.localeCompare(b.task);
      }),
    [todos]
  );

  useEffect(() => {
    const merged = mergeAutoTodos(loadStored(), autoTodos);
    saveStored(merged);
    setTodos(merged);
    setReady(true);
  }, [autoTodos]);

  useEffect(() => {
    if (!ready) return;
    const section = sectionRef.current;
    if (!section) return;

    function align() {
      const current = sectionRef.current;
      const row = current?.parentElement;
      const invoicing = document.getElementById("overview-invoicing");
      const docs = document.getElementById("sidebar-documentation");
      const clear = () => {
        row?.style.removeProperty("height");
      };
      if (!current || !row || !invoicing || !docs || window.innerWidth < 768) {
        clear();
        return;
      }
      const marginBottom = Number.parseFloat(getComputedStyle(row).marginBottom) || 0;
      const height = Math.round(
        docs.getBoundingClientRect().bottom -
          row.getBoundingClientRect().top -
          marginBottom -
          invoicing.getBoundingClientRect().height
      );
      if (height < 180) {
        clear();
        return;
      }
      row.style.height = `${height}px`;
    }

    align();
    const observer = new ResizeObserver(align);
    const invoicing = document.getElementById("overview-invoicing");
    const docs = document.getElementById("sidebar-documentation");
    if (invoicing) observer.observe(invoicing);
    if (docs) observer.observe(docs);
    window.addEventListener("resize", align);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", align);
      section.parentElement?.style.removeProperty("height");
    };
  }, [ready]);

  function update(next: StoredTodo[]) {
    setTodos(next);
    saveStored(next);
  }

  function addTodo(event: React.FormEvent) {
    event.preventDefault();
    const text = task.trim();
    if (!text) return;
    update([
      ...todos,
      {
        id: crypto.randomUUID(),
        task: text,
        dueDate: dueDate || overviewTodoDueDate(),
        done: false,
        note: "",
        sourceKey: null,
      },
    ]);
    setTask("");
    setDueDate(overviewTodoDueDate());
  }

  return (
    <section
      ref={sectionRef}
      className="flex h-full min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <h2 className="shrink-0 text-lg font-semibold text-[#ff69b4]">To Do</h2>

      <div className="-mr-4 mt-4 min-h-0 flex-1 overflow-auto pr-4 sm:-mr-6 sm:pr-6">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="w-14 py-2 pr-2 font-medium">Done</th>
              <th className="py-2 pr-2 font-medium">To Do</th>
              <th className="w-36 py-2 font-medium">Due date</th>
            </tr>
          </thead>
          <tbody>
            {ready && rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-4 text-slate-500">
                  Nothing to do.
                </td>
              </tr>
            ) : null}
            {rows.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="py-2 pr-2 align-top">
                  <input
                    type="checkbox"
                    checked={item.done}
                    aria-label={`Done: ${item.task}`}
                    onChange={(event) =>
                      update(
                        todos.map((todo) =>
                          todo.id === item.id
                            ? { ...todo, done: event.target.checked }
                            : todo
                        )
                      )
                    }
                    className="mt-1 h-4 w-4 accent-brand-600"
                  />
                </td>
                <td className="py-2 pr-2 align-top">
                  <span
                    className={`block ${item.done ? "text-slate-400 line-through" : "text-slate-800"}`}
                  >
                    {item.task}
                  </span>
                  <TodoNote
                    note={item.note}
                    task={item.task}
                    onSave={(note) =>
                      update(
                        todos.map((todo) =>
                          todo.id === item.id ? { ...todo, note } : todo
                        )
                      )
                    }
                  />
                </td>
                <td className="py-2 align-top">
                  <input
                    type="date"
                    value={item.dueDate}
                    aria-label={`Due date for ${item.task}`}
                    onChange={(event) =>
                      update(
                        todos.map((todo) =>
                          todo.id === item.id
                            ? { ...todo, dueDate: event.target.value }
                            : todo
                        )
                      )
                    }
                    className={`w-full rounded border border-slate-200 px-1 py-1 text-sm ${
                      item.done
                        ? "font-normal text-slate-400 [&::-webkit-datetime-edit]:font-normal [&::-webkit-datetime-edit]:text-slate-400"
                        : item.dueDate && item.dueDate < todayDateInputValue()
                          ? "font-bold text-red-600 [&::-webkit-datetime-edit]:font-bold [&::-webkit-datetime-edit]:text-red-600"
                          : "text-slate-800"
                    }`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={addTodo} className="mt-3 flex shrink-0 flex-col gap-2 sm:flex-row">
        <input
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder="Add a to do"
          aria-label="To do"
          className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          aria-label="Due date"
          className="min-h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-900"
        />
        <button
          type="submit"
          className="min-h-9 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"
        >
          Add
        </button>
      </form>
    </section>
  );
}
