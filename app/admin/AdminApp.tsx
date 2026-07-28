"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type User = {
  id: string;
  email: string;
  displayName: string;
  role: "super_admin" | "admin";
  mustChangePassword: boolean;
  csrfToken: string;
  active?: boolean;
  lastLoginAt?: string | null;
};

type Volunteer = {
  id: string;
  name: string;
  email: string;
  contactPlatform: "whatsapp" | "telegram" | "discord";
  contactHandle: string;
  skills: string[];
  languages: string[];
  availability: string;
  note: string;
  language: string;
  status: string;
  internalNotes: string;
  createdAt: string;
  retentionEligibleAt: string | null;
};

type Contribution = {
  id: string;
  kind: "image" | "writing";
  title: string;
  credit: string;
  body: string;
  language: string;
  storageKey: string | null;
  socialStorageKey: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  status: string;
  internalNotes: string;
  declineReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

type ContentEntry = {
  id: string;
  collection: string;
  recordId: string;
  language: "en" | "hi";
  sortOrder: number;
  draft: Record<string, unknown>;
  published: Record<string, unknown> | null;
  version: number;
  publishedAt: string | null;
};

type AdminData = {
  authenticated: true;
  user: User;
  collections: string[];
  volunteers: Volunteer[];
  contributions: Contribution[];
  content: ContentEntry[];
  users: User[];
  audits: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: string;
  }[];
};

function accountDisplayName(user: Pick<User, "displayName" | "role">) {
  return user.role === "super_admin" ? "Super admin" : user.displayName;
}

const statuses = ["new", "contacted", "accepted", "declined", "archived"];

const contributionStatuses = ["pending", "approved", "declined", "withdrawn"];

// Shown to the contributor when they enter their recovery code, so these are
// worded to be read by the person whose work was declined. Internal notes stay
// in the admin panel.
const declineReasons: Record<string, string> = {
  off_topic: "Not related to the movement",
  not_own_work: "Appears to be someone else's work",
  identifying_info: "Contains information that could identify people",
  low_quality: "Resolution too low to be usable",
  duplicate: "Already in the collection",
  other: "Other",
};

const emptyTemplates: Record<string, Record<string, unknown>> = {
  updates: {
    id: "new-update",
    language: "en",
    title: "",
    summary: "",
    city: "New Delhi",
    zone: "Broad zone",
    eventTime: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    status: "reported",
    sensitivity: "low",
    sources: [
      {
        label: "",
        url: "https://",
        tier: "B",
        accessedAt: new Date().toISOString(),
      },
    ],
    reviewers: [""],
  },
  demands: {
    id: "new-demand",
    language: "en",
    text: "",
    approvedBy: "",
    approvedAt: new Date().toISOString(),
    version: "1.0",
    sources: [],
  },
  "government-responses": {
    id: "new-response",
    language: "en",
    authority: "",
    title: "",
    summary: "",
    issuedAt: new Date().toISOString(),
    source: {
      label: "",
      url: "https://",
      tier: "A",
      accessedAt: new Date().toISOString(),
    },
  },
  timeline: {
    id: "new-timeline-item",
    language: "en",
    date: new Date().toISOString(),
    title: "",
    summary: "",
    status: "verified",
    sources: [],
  },
  corrections: {
    id: "new-correction",
    language: "en",
    targetType: "update",
    targetId: "",
    originalText: "",
    correctedText: "",
    reason: "",
    correctedAt: new Date().toISOString(),
    approvedBy: [""],
  },
  "reading-room": {
    id: "new-reading-item",
    language: "en",
    title: "",
    kind: "Primary source",
    summary: "",
    href: "https://",
  },
  resources: {
    id: "new-resource",
    language: "en",
    title: "",
    owner: "",
    category: "",
    summary: "",
    href: "https://",
    reliability: "established",
    reviewedAt: new Date().toISOString().slice(0, 10),
  },
  landing: {
    id: "new-landing-section",
    language: "en",
    title: "",
    body: "",
  },
};

export function AdminApp() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<
    "content" | "volunteers" | "contributions" | "users" | "audit"
  >(
    "content",
  );
  const [temporaryPassword, setTemporaryPassword] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin", { cache: "no-store" });
    const value = await response.json();
    setData(value.authenticated ? value : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch("/api/admin", { cache: "no-store" })
      .then((response) => response.json())
      .then((value) => {
        setData(value.authenticated ? value : null);
        setLoading(false);
      })
      .catch(() => {
        setError("The admin service is unavailable.");
        setLoading(false);
      });
  }, [refresh]);

  async function mutate(body: Record<string, unknown>) {
    setError("");
    setNotice("");
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(data?.user.csrfToken
          ? { "x-tip-csrf": data.user.csrfToken }
          : {}),
      },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "Request failed");
    if (value.temporaryPassword) setTemporaryPassword(value.temporaryPassword);
    await refresh();
    return value;
  }

  if (loading) {
    return (
      <main className="admin-shell admin-centered">
        <p>Opening the protected workspace…</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="admin-shell admin-centered">
        <section className="admin-login-card">
          <Image src="/brand/compact-logo.png" alt="The India Project" width={246} height={227} priority />
          <p className="eyebrow">Protected workspace</p>
          <h1>Admin sign in</h1>
          <p>Editorial records and volunteer details are available only to authorised administrators.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              try {
                await mutate({
                  action: "login",
                  email: form.get("email"),
                  password: form.get("password"),
                });
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Sign in failed");
              }
            }}
          >
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary" type="submit">Sign in</button>
          </form>
          <Link className="text-link" href="/">Return to public site</Link>
        </section>
      </main>
    );
  }

  if (data.user.mustChangePassword) {
    return (
      <main className="admin-shell admin-centered">
        <section className="admin-login-card">
          <p className="eyebrow">First sign in</p>
          <h1>Choose a permanent password</h1>
          <p>Your one-time password must be replaced before you can access records.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              try {
                await mutate({
                  action: "change_password",
                  currentPassword: form.get("currentPassword"),
                  newPassword: form.get("newPassword"),
                });
                setData(null);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Unable to change password");
              }
            }}
          >
            <label>Temporary password<input name="currentPassword" type="password" required /></label>
            <label>New password<input name="newPassword" type="password" minLength={12} required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary" type="submit">Change password</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="eyebrow">The India Project</p>
          <h1>Editorial workspace</h1>
          <p>
            {data.user.role === "super_admin"
              ? "Super admin"
              : `${data.user.displayName} · Admin`}
          </p>
        </div>
        <div className="admin-header-actions">
          <Link className="button" href="/">View public site</Link>
          <button
            className="button"
            onClick={async () => {
              await fetch("/api/admin", {
                method: "DELETE",
                headers: { "x-tip-csrf": data.user.csrfToken },
              });
              setData(null);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        <button className={tab === "content" ? "active" : ""} onClick={() => setTab("content")}>Content</button>
        <button className={tab === "volunteers" ? "active" : ""} onClick={() => setTab("volunteers")}>Volunteers ({data.volunteers.length})</button>
        <button className={tab === "contributions" ? "active" : ""} onClick={() => setTab("contributions")}>
          Contributions ({data.contributions.filter((item) => item.status === "pending").length})
        </button>
        {data.user.role === "super_admin" && (
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Users</button>
        )}
        <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>Audit log</button>
      </nav>

      {error && <p className="admin-banner error" role="alert">{error}</p>}
      {notice && <p className="admin-banner">{notice}</p>}
      {temporaryPassword && (
        <div className="admin-banner temporary-password">
          <strong>Copy this one-time password now:</strong>
          <code>{temporaryPassword}</code>
          <button onClick={() => void navigator.clipboard.writeText(temporaryPassword)}>Copy</button>
          <button onClick={() => setTemporaryPassword("")}>Dismiss</button>
        </div>
      )}

      {tab === "content" && (
        <ContentWorkspace
          data={data}
          mutate={mutate}
          setError={setError}
          setNotice={setNotice}
        />
      )}
      {tab === "volunteers" && (
        <VolunteerWorkspace
          volunteers={data.volunteers}
          mutate={mutate}
          setError={setError}
          setNotice={setNotice}
        />
      )}
      {tab === "contributions" && (
        <ContributionWorkspace
          contributions={data.contributions}
          mutate={mutate}
          setError={setError}
          setNotice={setNotice}
        />
      )}
      {tab === "users" && data.user.role === "super_admin" && (
        <UserWorkspace users={data.users} mutate={mutate} setError={setError} setNotice={setNotice} />
      )}
      {tab === "audit" && (
        <section className="admin-panel">
          <div className="admin-panel-heading"><div><p className="eyebrow">Accountability</p><h2>Recent audit events</h2></div></div>
          <div className="admin-table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Action</th><th>Record type</th><th>Record</th></tr></thead>
              <tbody>
                {data.audits.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td>{event.action}</td>
                    <td>{event.entityType}</td>
                    <td>{event.entityId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function ContentWorkspace({
  data,
  mutate,
  setError,
  setNotice,
}: {
  data: AdminData;
  mutate: (body: Record<string, unknown>) => Promise<unknown>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const [collection, setCollection] = useState(data.collections[0] ?? "updates");
  const [newDraft, setNewDraft] = useState<Record<string, unknown> | null>(null);
  const entries = useMemo(
    () => data.content.filter((entry) => entry.collection === collection),
    [collection, data.content],
  );

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div><p className="eyebrow">Full editorial CMS</p><h2>Published content</h2></div>
        <div className="admin-actions">
          <select value={collection} onChange={(event) => { setCollection(event.target.value); setNewDraft(null); }}>
            {data.collections.map((name) => <option key={name}>{name}</option>)}
          </select>
          <button className="button" onClick={() => setNewDraft(structuredClone(emptyTemplates[collection]))}>Add record</button>
          <button
            className="button button-primary"
            onClick={async () => {
              try {
                await mutate({ action: "content_publish_collection", collection });
                setNotice(`${collection} published. Public pages now use this version.`);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Publish failed");
              }
            }}
          >
            Publish collection
          </button>
        </div>
      </div>
      <p className="admin-help">Save individual drafts, then publish the complete collection. Update publishing also creates a matching signed feed release.</p>
      {newDraft && (
        <StructuredRecordEditor
          key={`new-${collection}`}
          collection={collection}
          payload={newDraft}
          sortOrder={entries.length}
          onCancel={() => setNewDraft(null)}
          onSave={async (payload, sortOrder) => {
            await mutate({
              action: "content_save",
              collection,
              recordId: payload.id,
              language: payload.language,
              sortOrder,
              payload,
            });
            setNewDraft(null);
            setNotice("New draft saved.");
          }}
          setError={setError}
        />
      )}
      <div className="admin-record-list">
        {entries.map((entry) => (
          <StructuredRecordEditor
            key={`${entry.id}-${entry.version}`}
            collection={collection}
            entryId={entry.id}
            payload={entry.draft}
            sortOrder={entry.sortOrder}
            publishedAt={entry.publishedAt}
            onSave={async (payload, sortOrder) => {
              await mutate({
                action: "content_save",
                id: entry.id,
                collection,
                recordId: payload.id,
                language: payload.language,
                sortOrder,
                payload,
              });
              setNotice("Draft saved.");
            }}
            onDelete={async () => {
              if (!window.confirm("Delete this record from the collection?")) return;
              await mutate({ action: "content_delete", id: entry.id });
              setNotice("Record deleted. Publish the collection to update the public site.");
            }}
            setError={setError}
          />
        ))}
      </div>
    </section>
  );
}

function StructuredRecordEditor({
  collection,
  entryId,
  payload,
  sortOrder: initialSortOrder,
  publishedAt,
  onSave,
  onDelete,
  onCancel,
  setError,
}: {
  collection: string;
  entryId?: string;
  payload: Record<string, unknown>;
  sortOrder: number;
  publishedAt?: string | null;
  onSave: (payload: Record<string, unknown>, sortOrder: number) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
  setError: (value: string) => void;
}) {
  const [draft, setDraft] = useState(payload);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);

  return (
    <details className="admin-record" open={!entryId}>
      <summary>
        <span><strong>{String(draft.title ?? draft.text ?? draft.id)}</strong><small>{String(draft.language)} · {publishedAt ? `published ${new Date(publishedAt).toLocaleString()}` : "draft only"}</small></span>
        <span>{collection}</span>
      </summary>
      <div className="structured-editor">
        {Object.entries(draft).map(([key, value]) => (
          <label key={key}>
            {key}
            {typeof value === "string" ? (
              value.length > 80 || ["summary", "body", "text", "reason", "originalText", "correctedText"].includes(key) ? (
                <textarea
                  value={value}
                  rows={key === "body" || key === "summary" ? 5 : 3}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                />
              ) : (
                <input value={value} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
              )
            ) : (
              <textarea
                value={JSON.stringify(value, null, 2)}
                rows={Math.min(14, Math.max(4, JSON.stringify(value, null, 2).split("\n").length + 1))}
                onChange={(event) => {
                  try {
                    setDraft({ ...draft, [key]: JSON.parse(event.target.value) });
                    event.target.setCustomValidity("");
                  } catch {
                    event.target.setCustomValidity("Enter valid JSON");
                  }
                }}
              />
            )}
          </label>
        ))}
        <label>sort order<input type="number" min={0} value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} /></label>
        <div className="admin-actions">
          <button
            className="button button-primary"
            onClick={async () => {
              try {
                await onSave(draft, sortOrder);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Unable to save");
              }
            }}
          >
            Save draft
          </button>
          {onCancel && <button className="button" onClick={onCancel}>Cancel</button>}
          {onDelete && <button className="button button-danger" onClick={() => void onDelete()}>Delete</button>}
        </div>
      </div>
    </details>
  );
}

function VolunteerWorkspace({
  volunteers,
  mutate,
  setError,
  setNotice,
}: {
  volunteers: Volunteer[];
  mutate: (body: Record<string, unknown>) => Promise<unknown>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = volunteers.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      `${item.name} ${item.email} ${item.contactPlatform} ${item.contactHandle} ${item.skills.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div><p className="eyebrow">Private intake</p><h2>Volunteer submissions</h2></div>
        <div className="admin-actions">
          <input aria-label="Search volunteers" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            {statuses.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
      </div>
      <div className="volunteer-admin-grid">
        {filtered.map((volunteer) => (
          <VolunteerCard
            key={`${volunteer.id}-${volunteer.status}-${volunteer.internalNotes}`}
            volunteer={volunteer}
            onSave={async (nextStatus, internalNotes) => {
              try {
                await mutate({ action: "volunteer_update", id: volunteer.id, status: nextStatus, internalNotes });
                setNotice("Volunteer record updated.");
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Unable to update");
              }
            }}
            onDelete={async () => {
              if (!window.confirm("Permanently delete this volunteer submission?")) return;
              await mutate({ action: "volunteer_delete", id: volunteer.id });
              setNotice("Volunteer submission deleted.");
            }}
          />
        ))}
      </div>
    </section>
  );
}

function VolunteerCard({
  volunteer,
  onSave,
  onDelete,
}: {
  volunteer: Volunteer;
  onSave: (status: string, notes: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [status, setStatus] = useState(volunteer.status);
  const [notes, setNotes] = useState(volunteer.internalNotes);
  return (
    <article className="volunteer-admin-card">
      <div><span className={`badge badge-${status}`}>{status}</span><small>{new Date(volunteer.createdAt).toLocaleString()}</small></div>
      <h3>{volunteer.name}</h3>
      <a href={`mailto:${volunteer.email}`}>{volunteer.email}</a>
      <p><strong>{volunteer.contactPlatform}:</strong> {volunteer.contactHandle || "Not provided"}</p>
      <p><strong>Skills:</strong> {volunteer.skills.join(", ")}</p>
      <p><strong>Languages:</strong> {volunteer.languages.join(", ")}</p>
      <p><strong>Availability:</strong> {volunteer.availability}</p>
      <p>{volunteer.note}</p>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Internal notes<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      {volunteer.retentionEligibleAt && <small>Cleanup eligible after {new Date(volunteer.retentionEligibleAt).toLocaleDateString()}</small>}
      <div className="admin-actions"><button className="button button-primary" onClick={() => void onSave(status, notes)}>Save</button><button className="button button-danger" onClick={() => void onDelete()}>Delete</button></div>
    </article>
  );
}

function ContributionWorkspace({
  contributions,
  mutate,
  setError,
  setNotice,
}: {
  contributions: Contribution[];
  mutate: (body: Record<string, unknown>) => Promise<unknown>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("pending");
  const filtered = contributions.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      `${item.title} ${item.credit} ${item.body}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div>
          <p className="eyebrow">Nothing is public until approved</p>
          <h2>Contributions</h2>
        </div>
        <div className="admin-actions">
          <input aria-label="Search contributions" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            {contributionStatuses.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
      </div>
      <div className="volunteer-admin-grid">
        {filtered.map((contribution) => (
          <ContributionCard
            key={`${contribution.id}-${contribution.status}`}
            contribution={contribution}
            onSave={async (nextStatus, internalNotes, declineReason) => {
              try {
                await mutate({
                  action: "contribution_update",
                  id: contribution.id,
                  status: nextStatus,
                  internalNotes,
                  declineReason,
                });
                setNotice("Contribution updated.");
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Unable to update");
              }
            }}
            onDelete={async () => {
              if (!window.confirm("Permanently delete this contribution and its files?")) return;
              await mutate({ action: "contribution_delete", id: contribution.id });
              setNotice("Contribution deleted.");
            }}
          />
        ))}
        {filtered.length === 0 && <p>Nothing here right now.</p>}
      </div>
    </section>
  );
}

function ContributionCard({
  contribution,
  onSave,
  onDelete,
}: {
  contribution: Contribution;
  onSave: (status: string, notes: string, declineReason: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [status, setStatus] = useState(contribution.status);
  const [notes, setNotes] = useState(contribution.internalNotes);
  const [reason, setReason] = useState(contribution.declineReason ?? "off_topic");
  return (
    <article className="volunteer-admin-card">
      <div>
        <span className={`badge badge-${status}`}>{status}</span>
        <small>{new Date(contribution.createdAt).toLocaleString()}</small>
      </div>
      <h3>{contribution.title}</h3>
      <p><strong>Credit:</strong> {contribution.credit || "Not given"}</p>
      {contribution.kind === "image" && contribution.storageKey && (
        <Image
          src={`/api/contributions/${contribution.id}/file?variant=social`}
          alt={contribution.title}
          width={320}
          height={400}
          unoptimized
          style={{ width: "100%", height: "auto", borderRadius: "0.5rem" }}
        />
      )}
      {contribution.kind === "writing" && (
        <p style={{ whiteSpace: "pre-wrap" }}>{contribution.body}</p>
      )}
      {contribution.width && contribution.height && (
        <small>{contribution.width} × {contribution.height} px</small>
      )}
      <label>
        Status
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {contributionStatuses.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      {status === "declined" && (
        <label>
          Reason shown to the contributor
          <select value={reason} onChange={(event) => setReason(event.target.value)}>
            {Object.entries(declineReasons).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Internal notes (never shown to the contributor)
        <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="admin-actions">
        <button
          className="button button-primary"
          onClick={() => void onSave(status, notes, status === "declined" ? reason : null)}
        >
          Save
        </button>
        <button className="button button-danger" onClick={() => void onDelete()}>Delete</button>
      </div>
    </article>
  );
}

function UserWorkspace({
  users,
  mutate,
  setError,
  setNotice,
}: {
  users: User[];
  mutate: (body: Record<string, unknown>) => Promise<unknown>;
  setError: (value: string) => void;
  setNotice: (value: string) => void;
}) {
  return (
    <section className="admin-panel">
      <div className="admin-panel-heading"><div><p className="eyebrow">Super-admin only</p><h2>Admin users</h2></div></div>
      <form
        className="admin-create-user"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          try {
            await mutate({ action: "user_create", displayName: form.get("displayName"), email: form.get("email"), role: form.get("role") });
            event.currentTarget.reset();
            setNotice("Admin created. Copy the one-time password before dismissing it.");
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Unable to create user");
          }
        }}
      >
        <label>Display name<input name="displayName" required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label>Role<select name="role"><option value="admin">Admin</option><option value="super_admin">Super admin</option></select></label>
        <button className="button button-primary" type="submit">Create user</button>
      </form>
      <div className="admin-table-wrap">
        <table>
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{accountDisplayName(user)}</strong>
                  <br />
                  <small>{user.email}</small>
                </td>
                <td>{user.role.replace("_", " ")}</td>
                <td>{user.active ? "active" : "disabled"}{user.mustChangePassword ? " · password change required" : ""}</td>
                <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
                <td><div className="admin-actions"><button className="button" onClick={async () => { try { await mutate({ action: "user_reset_password", id: user.id }); setNotice("Password reset. Copy the one-time password."); } catch (caught) { setError(caught instanceof Error ? caught.message : "Reset failed"); } }}>Reset password</button><button className="button" onClick={async () => { try { await mutate({ action: "user_set_active", id: user.id, active: !user.active }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Update failed"); } }}>{user.active ? "Disable" : "Enable"}</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
