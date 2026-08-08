"use client";

import {
  AlertTriangle,
  ContactRound,
  Download,
  FlaskConical,
  Languages,
  LockKeyhole,
  MessageSquareOff,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import type { SupportedLanguage } from "@/lib/domain";
import { getLocalEmulatorFirestore } from "@/lib/firebase/auth-emulator";
import {
  updateSyntheticContactPreferences,
  type SafeContactTag,
} from "@/lib/firebase/repositories";
import { loadContactWorkspace } from "./contact-workspace-data";
import {
  isContactPreferenceConflict,
  normalizedContactSearch,
  normalizedMarketingStatus,
  preferenceDraftChanged,
  preferenceDraftFromContact,
  safeContactLoadMessage,
  safeContactSaveMessage,
  withOperationalTags,
  withPreferredLanguage,
} from "./contact-workspace-model";
import { ContactDetail } from "./contact-detail";
import { ContactDirectory } from "./contact-directory";
import type {
  ContactDirectoryRecord,
  ContactLanguageFilter,
  ContactPreferenceDraft,
  ContactPreferenceDrafts,
  LocalContactActivity,
  LocalSuppressionPreviews,
  MarketingConsentFilter,
  PreferenceSaveStatus,
  PreferenceSaveStatuses,
} from "./types";

type DirectoryLoadState = "loading" | "ready" | "error";

function DirectorySkeleton() {
  return (
    <section
      aria-label="Loading contacts from the local Firestore emulator"
      aria-busy="true"
      className="grid min-h-[68dvh] gap-3 md:h-full md:min-h-0 md:grid-cols-[320px_minmax(0,1fr)]"
    >
      <div className="rounded-2xl border border-[var(--line)] bg-white p-4">
        <div className="h-5 w-24 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-10 animate-pulse rounded-xl bg-slate-100" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
        </div>
        <div className="mt-5 space-y-3">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"
            >
              <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200" />
              <div className="flex-1">
                <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="mt-2 h-2.5 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 animate-pulse rounded-full bg-slate-200" />
          <div className="flex-1">
            <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
            <div className="mt-2 h-3 w-56 max-w-full animate-pulse rounded bg-slate-100" />
          </div>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
        <p className="mt-5 text-center text-xs font-semibold text-slate-500">
          Loading bounded synthetic records and immutable consent evidence…
        </p>
      </div>
    </section>
  );
}

export function ContactsWorkspace() {
  const workspaceSnapshot = useWorkspaceSession();
  const workspaceSession = workspaceSnapshot.session;
  const workspaceId = workspaceSession?.workspaceId ?? null;
  const workspaceRole = workspaceSession?.role ?? null;
  const workspaceScopeMode = workspaceSession?.scopeMode ?? null;
  const teamIdsKey = workspaceSession?.teamIds.join("\u001f") ?? "";
  const locationIdsKey = workspaceSession?.locationIds.join("\u001f") ?? "";
  const canPersistPreferences = workspaceSession?.role === "tenant_admin";
  const [records, setRecords] = useState<readonly ContactDirectoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState<ContactLanguageFilter>("all");
  const [marketing, setMarketing] = useState<MarketingConsentFilter>("all");
  const [suppressionOnly, setSuppressionOnly] = useState(false);
  const [drafts, setDrafts] = useState<ContactPreferenceDrafts>({});
  const [suppressionPreviews, setSuppressionPreviews] =
    useState<LocalSuppressionPreviews>({});
  const [saveStatuses, setSaveStatuses] = useState<PreferenceSaveStatuses>({});
  const [activities, setActivities] = useState<readonly LocalContactActivity[]>([]);
  const [loadState, setLoadState] = useState<DirectoryLoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const activitySequence = useRef(0);
  const loadSequence = useRef(0);

  const queryDirectory = useCallback(async (): Promise<readonly ContactDirectoryRecord[]> => {
    if (!workspaceId || !workspaceRole || !workspaceScopeMode) return [];
    return loadContactWorkspace(getLocalEmulatorFirestore(), {
      workspaceId,
      role: workspaceRole,
      scopeMode: workspaceScopeMode,
      teamIds: teamIdsKey ? teamIdsKey.split("\u001f") : [],
      locationIds: locationIdsKey ? locationIdsKey.split("\u001f") : [],
    });
  }, [locationIdsKey, teamIdsKey, workspaceId, workspaceRole, workspaceScopeMode]);

  const installRecords = useCallback(
    (nextRecords: readonly ContactDirectoryRecord[], clearDraftContactId?: string | "all") => {
      setRecords(nextRecords);
      setSelectedId((current) => {
        if (current && nextRecords.some((record) => record.contact.id === current)) return current;
        return nextRecords[0]?.contact.id ?? null;
      });
      if (clearDraftContactId === "all") {
        setDrafts({});
      } else if (clearDraftContactId) {
        setDrafts((current) => {
          const next = { ...current };
          delete next[clearDraftContactId];
          return next;
        });
      }
    },
    [],
  );

  useEffect(() => {
    const request = ++loadSequence.current;
    if (workspaceSnapshot.status !== "verified" || !workspaceId) return;

    queueMicrotask(() => {
      if (request !== loadSequence.current) return;
      setLoadState("loading");
      setLoadError(null);
      void queryDirectory()
        .then((nextRecords) => {
          if (request !== loadSequence.current) return;
          installRecords(nextRecords);
          setLoadState("ready");
          setAnnouncement(
            `${nextRecords.length} synthetic contacts loaded from the local Firestore emulator.`,
          );
        })
        .catch((error: unknown) => {
          if (request !== loadSequence.current) return;
          const message = safeContactLoadMessage(error);
          setLoadError(message);
          setLoadState("error");
          setAnnouncement(message);
        });
    });

    return () => {
      if (loadSequence.current === request) loadSequence.current += 1;
    };
  }, [installRecords, queryDirectory, workspaceId, workspaceSnapshot.status]);

  const selectedRecord =
    records.find((record) => record.contact.id === selectedId) ?? records[0] ?? null;

  const filteredRecords = useMemo(() => {
    const query = normalizedContactSearch(search);
    return records.filter((record) => {
      const draft = drafts[record.contact.id];
      const preferredLanguage = draft?.preferredLanguage ?? record.contact.preferredLanguage;
      const tags = draft?.tags ?? record.contact.tags;
      const suppressed =
        suppressionPreviews[record.contact.id] ??
        (record.contact.suppression.suppressMarketing ||
          record.contact.suppression.suppressAll ||
          record.contact.suppression.invalidContact);
      const searchable = [record.contact.displayLabel, record.contact.maskedPhone, ...tags]
        .join(" ")
        .toLocaleLowerCase();
      return (
        (!query || searchable.includes(query)) &&
        (language === "all" || preferredLanguage === language) &&
        (marketing === "all" || normalizedMarketingStatus(record.consentRecords) === marketing) &&
        (!suppressionOnly || suppressed)
      );
    });
  }, [drafts, language, marketing, records, search, suppressionOnly, suppressionPreviews]);

  const currentLanguages = useMemo(
    () =>
      records.reduce<Record<SupportedLanguage, number>>(
        (counts, record) => {
          const current =
            drafts[record.contact.id]?.preferredLanguage ?? record.contact.preferredLanguage;
          counts[current] += 1;
          return counts;
        },
        { en: 0, si: 0, ta: 0 },
      ),
    [drafts, records],
  );
  const currentSuppressed = useMemo(
    () =>
      records.filter(
        (record) =>
          suppressionPreviews[record.contact.id] ??
          (record.contact.suppression.suppressMarketing ||
            record.contact.suppression.suppressAll ||
            record.contact.suppression.invalidContact),
      ).length,
    [records, suppressionPreviews],
  );
  const unsavedCount = useMemo(
    () =>
      records.filter((record) => preferenceDraftChanged(record.contact, drafts[record.contact.id]))
        .length,
    [drafts, records],
  );

  function recordActivity(contactId: string, label: string) {
    activitySequence.current += 1;
    setActivities((current) => [
      ...current,
      {
        id: `contact-session-activity-${activitySequence.current}`,
        contactId,
        label,
        occurredAt: new Date().toISOString(),
      },
    ]);
  }

  function setSelectedDraft(
    transform: (current: ContactPreferenceDraft) => ContactPreferenceDraft,
  ) {
    if (!selectedRecord) return;
    const contact = selectedRecord.contact;
    setDrafts((current) => ({
      ...current,
      [contact.id]: transform(current[contact.id] ?? preferenceDraftFromContact(contact)),
    }));
    setSaveStatuses((current) => ({ ...current, [contact.id]: { kind: "idle" } }));
  }

  function discardSelectedDraft() {
    if (!selectedRecord) return;
    const contactId = selectedRecord.contact.id;
    setDrafts((current) => {
      const next = { ...current };
      delete next[contactId];
      return next;
    });
    setSaveStatuses((current) => ({ ...current, [contactId]: { kind: "idle" } }));
    setAnnouncement("Unsaved preference changes discarded. Firestore was not changed.");
  }

  async function refreshDirectory(options?: {
    clearDraftContactId?: string | "all";
    announce?: boolean;
    initial?: boolean;
  }): Promise<boolean> {
    const request = ++loadSequence.current;
    if (options?.initial) {
      setLoadState("loading");
      setLoadError(null);
    } else {
      setIsRefreshing(true);
      setRefreshError(null);
    }
    try {
      const nextRecords = await queryDirectory();
      if (request !== loadSequence.current) return false;
      installRecords(nextRecords, options?.clearDraftContactId);
      if (options?.initial) setLoadState("ready");
      if (options?.announce !== false) {
        setAnnouncement(
          `${nextRecords.length} authoritative synthetic contacts refreshed from Firestore.`,
        );
      }
      return true;
    } catch (error) {
      if (request !== loadSequence.current) return false;
      const message = safeContactLoadMessage(error);
      if (options?.initial) {
        setLoadError(message);
        setLoadState("error");
      } else {
        setRefreshError(message);
      }
      setAnnouncement(message);
      return false;
    } finally {
      if (request === loadSequence.current && !options?.initial) setIsRefreshing(false);
    }
  }

  async function saveSelectedPreferences() {
    if (!selectedRecord || !workspaceId || !canPersistPreferences) return;
    const contact = selectedRecord.contact;
    const draft = drafts[contact.id];
    if (!preferenceDraftChanged(contact, draft) || !draft) return;

    setSaveStatuses((current) => ({
      ...current,
      [contact.id]: {
        kind: "working",
        message: `Saving against Firestore revision ${contact.preferenceRevision}…`,
      },
    }));
    setAnnouncement("Saving synthetic contact preferences to the local Firestore emulator.");

    try {
      const result = await updateSyntheticContactPreferences(getLocalEmulatorFirestore(), {
        workspaceId,
        contactId: contact.id,
        preferredLanguage: draft.preferredLanguage,
        alternateLanguages: [...draft.alternateLanguages],
        tags: [...draft.tags],
        expectedPreferenceRevision: contact.preferenceRevision,
      });
      const confirmed = await refreshDirectory({
        clearDraftContactId: contact.id,
        announce: false,
      });
      if (!confirmed) {
        const message =
          "The update completed, but the authoritative emulator record could not be reloaded. Refresh before making another change.";
        setSaveStatuses((current) => ({
          ...current,
          [contact.id]: { kind: "error", message },
        }));
        setAnnouncement(message);
        return;
      }
      const message = `Preferences saved and reloaded from Firestore at revision ${result.preferenceRevision}.`;
      setSaveStatuses((current) => ({
        ...current,
        [contact.id]: {
          kind: "success",
          message,
          revision: result.preferenceRevision,
        },
      }));
      recordActivity(contact.id, message);
      setAnnouncement(message);
    } catch (error) {
      if (isContactPreferenceConflict(error)) {
        const reloaded = await refreshDirectory({
          clearDraftContactId: contact.id,
          announce: false,
        });
        const message = reloaded
          ? "Save blocked because another session changed this contact. The latest Firestore preferences were reloaded; review them before trying again."
          : "Save blocked because another session changed this contact, but the latest Firestore preferences could not be reloaded. Refresh before trying again.";
        setSaveStatuses((current) => ({
          ...current,
          [contact.id]: { kind: "conflict", message },
        }));
        recordActivity(contact.id, "Stale preference save blocked by revision conflict");
        setAnnouncement(message);
        return;
      }

      const message = safeContactSaveMessage(error);
      setSaveStatuses((current) => ({
        ...current,
        [contact.id]: { kind: "error", message },
      }));
      setAnnouncement(message);
    }
  }

  function resetFilters() {
    setSearch("");
    setLanguage("all");
    setMarketing("all");
    setSuppressionOnly(false);
  }

  function selectRecord(record: ContactDirectoryRecord) {
    setSelectedId(record.contact.id);
    setMobileDetailOpen(true);
    setAnnouncement(`Opened synthetic contact ${record.contact.displayLabel}.`);
  }

  function previewSuppression(suppressed: boolean) {
    if (!selectedRecord) return;
    const contactId = selectedRecord.contact.id;
    setSuppressionPreviews((current) => ({ ...current, [contactId]: suppressed }));
    const message = suppressed
      ? "Marketing suppression preview enabled locally. Source evidence was not changed."
      : "Marketing suppression preview removed. Source evidence was not changed.";
    recordActivity(contactId, message);
    setAnnouncement(message);
  }

  const selectedSaveStatus: PreferenceSaveStatus = selectedRecord
    ? saveStatuses[selectedRecord.contact.id] ?? { kind: "idle" }
    : { kind: "idle" };

  return (
    <div className="space-y-4 lg:space-y-5">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <ContactRound size={21} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
              Patient operations
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
              Contacts
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Inspect minimum-necessary synthetic records, persist governed preferences and
              review immutable consent evidence through authenticated Firestore emulator reads.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refreshDirectory({ clearDraftContactId: "all" })}
            disabled={isRefreshing || loadState === "loading" || unsavedCount > 0}
            title={
              unsavedCount > 0
                ? "Discard or save every preference draft before refreshing"
                : "Reload authoritative contacts and consent evidence from Firestore"
            }
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400"
          >
            <RefreshCw
              size={14}
              className={isRefreshing ? "animate-spin" : ""}
              aria-hidden="true"
            />
            {isRefreshing ? "Refreshing…" : "Refresh from Firestore"}
          </button>
          <button
            type="button"
            disabled
            title="Contact import is unavailable in the synthetic demo"
            className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-xl bg-slate-200 px-3 text-xs font-bold text-slate-400"
          >
            <Upload size={14} aria-hidden="true" /> Import unavailable
          </button>
          <button
            type="button"
            disabled
            title="Contact export is unavailable in the synthetic demo"
            className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-xl bg-slate-200 px-3 text-xs font-bold text-slate-400"
          >
            <Download size={14} aria-hidden="true" /> Export unavailable
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Synthetic contact metrics">
        <article className="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
          <p className="text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400">
            Firestore contacts
          </p>
          <p className="mt-1 text-lg font-bold text-slate-900">{records.length}</p>
        </article>
        <article className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-cyan-600">
            <Languages size={10} aria-hidden="true" /> Languages
          </p>
          <p className="mt-1 text-sm font-bold text-cyan-900">
            EN {currentLanguages.en} · SI {currentLanguages.si} · TA {currentLanguages.ta}
          </p>
        </article>
        <article className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-red-500">
            <ShieldOff size={10} aria-hidden="true" /> Suppressed
          </p>
          <p className="mt-1 text-lg font-bold text-red-900">{currentSuppressed}</p>
        </article>
        <article className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-violet-600">
            <FlaskConical size={10} aria-hidden="true" /> Unsaved drafts
          </p>
          <p className="mt-1 text-lg font-bold text-violet-900">{unsavedCount}</p>
        </article>
      </section>

      <section
        className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center"
        role="status"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
          <LockKeyhole size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-emerald-950">
            Authenticated local Firestore system of record
          </p>
          <p className="mt-0.5 text-[11px] leading-5 text-emerald-800">
            Bounded emulator reads and optimistic synthetic preference writes only. Consent,
            STOP and source suppression evidence remain immutable.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-[10px] font-bold text-emerald-800 sm:self-auto">
          <MessageSquareOff size={12} aria-hidden="true" /> Messaging unavailable
        </span>
      </section>

      {refreshError && loadState === "ready" ? (
        <section
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900"
          role="alert"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Refresh failed safely</p>
            <p className="mt-0.5 text-[11px] leading-5">{refreshError}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshDirectory()}
            className="shrink-0 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-red-800"
          >
            Retry
          </button>
        </section>
      ) : null}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {loadState === "loading" ? (
        <DirectorySkeleton />
      ) : loadState === "error" ? (
        <section className="grid min-h-[55dvh] place-items-center rounded-2xl border border-red-200 bg-white p-6 text-center" role="alert">
          <div className="max-w-md">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-700">
              <AlertTriangle size={21} aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-950">Contact directory unavailable</h2>
            <p className="mt-2 text-xs leading-5 text-slate-600">{loadError}</p>
            <button
              type="button"
              onClick={() => void refreshDirectory({ initial: true })}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-xs font-bold text-white"
            >
              <RefreshCw size={14} aria-hidden="true" /> Retry Firestore load
            </button>
          </div>
        </section>
      ) : records.length === 0 ? (
        <section className="grid min-h-[55dvh] place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <div className="max-w-md">
            <ContactRound size={28} className="mx-auto text-slate-400" aria-hidden="true" />
            <h2 className="mt-3 text-sm font-bold text-slate-900">No synthetic contacts seeded</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              The authenticated workspace query succeeded but returned no contacts. Seed the
              local emulators, then refresh this directory.
            </p>
            <button
              type="button"
              onClick={() => void refreshDirectory()}
              className="mt-4 h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Refresh from Firestore
            </button>
          </div>
        </section>
      ) : (
        <div className="grid gap-3 md:h-[calc(100dvh-19rem)] md:min-h-[680px] md:grid-cols-[320px_minmax(0,1fr)]">
          <div
            className={`min-h-0 min-w-0 md:h-full ${mobileDetailOpen ? "hidden md:block" : "block"}`}
          >
            <ContactDirectory
              records={filteredRecords}
              selectedId={selectedRecord?.contact.id ?? null}
              drafts={drafts}
              suppressionPreviews={suppressionPreviews}
              search={search}
              language={language}
              marketing={marketing}
              suppressionOnly={suppressionOnly}
              onSearchChange={setSearch}
              onLanguageChange={setLanguage}
              onMarketingChange={setMarketing}
              onSuppressionOnlyChange={setSuppressionOnly}
              onResetFilters={resetFilters}
              onSelect={selectRecord}
            />
          </div>

          <div
            className={
              !mobileDetailOpen
                ? "hidden min-h-0 min-w-0 md:block md:h-full"
                : "min-h-0 min-w-0 md:h-full"
            }
          >
            {selectedRecord ? (
              <ContactDetail
                key={selectedRecord.contact.id}
                record={selectedRecord}
                draft={drafts[selectedRecord.contact.id]}
                suppressionPreview={suppressionPreviews[selectedRecord.contact.id]}
                activities={activities.filter(
                  (activity) => activity.contactId === selectedRecord.contact.id,
                )}
                saveStatus={selectedSaveStatus}
                canPersistPreferences={canPersistPreferences}
                onBack={() => setMobileDetailOpen(false)}
                onLanguageChange={(nextLanguage) =>
                  setSelectedDraft((current) => withPreferredLanguage(current, nextLanguage))
                }
                onTagsChange={(nextTags: readonly SafeContactTag[]) =>
                  setSelectedDraft((current) => withOperationalTags(current, nextTags))
                }
                onSuppressionChange={previewSuppression}
                onDiscardPreferenceDraft={discardSelectedDraft}
                onSavePreferences={() => void saveSelectedPreferences()}
              />
            ) : (
              <section className="grid h-full min-h-[60dvh] place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
                <div>
                  <ContactRound size={26} className="mx-auto text-slate-400" aria-hidden="true" />
                  <h2 className="mt-3 text-sm font-bold text-slate-900">
                    Select a synthetic contact
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Choose a Firestore-backed record to inspect its safe profile.
                  </p>
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      <section
        className="grid gap-2 text-[10px] text-slate-600 sm:grid-cols-3"
        aria-label="Contacts workspace guardrails"
      >
        <span className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
          <ShieldCheck size={14} className="text-emerald-700" aria-hidden="true" /> Consent evidence stays immutable
        </span>
        <span className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
          <LockKeyhole size={14} className="text-slate-700" aria-hidden="true" /> Protected identifiers are excluded
        </span>
        <span className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
          <MessageSquareOff size={14} className="text-amber-700" aria-hidden="true" /> No outbound path exists here
        </span>
      </section>
    </div>
  );
}
