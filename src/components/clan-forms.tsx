"use client";

import { useActionState } from "react";
import { Hash, Plus, UsersRound } from "lucide-react";
import { createClanAction, joinClanAction } from "@/actions/clans";
import { FormMessage, SubmitButton } from "@/components/form-controls";

export function ClanForms() {
  const [createState, createAction] = useActionState(createClanAction, {});
  const [joinState, joinAction] = useActionState(joinClanAction, {});

  return (
    <div className="clan-form-grid">
      <form action={createAction} className="panel clan-form">
        <span className="panel-icon"><Plus aria-hidden="true" /></span>
        <p className="eyebrow">Din egen hjemmebane</p>
        <h2>Opret en klan</h2>
        <p>Saml vennerne, og få jeres egen interne top.</p>
        <div className="field">
          <label htmlFor="clan-name">Klannavn</label>
          <div className="input-wrap">
            <UsersRound aria-hidden="true" />
            <input id="clan-name" name="name" minLength={2} maxLength={64} placeholder="Sommerhus 2026" required />
          </div>
        </div>
        <FormMessage {...createState} />
        <SubmitButton className="button--primary button--wide" pendingLabel="Opretter...">Opret klan</SubmitButton>
      </form>

      <form action={joinAction} className="panel clan-form panel--amber">
        <span className="panel-icon"><Hash aria-hidden="true" /></span>
        <p className="eyebrow">Har du fået en kode?</p>
        <h2>Hop ind</h2>
        <p>Indsæt invitationskoden fra klanens ejer.</p>
        <div className="field">
          <label htmlFor="invite-code">Invitationskode</label>
          <div className="input-wrap input-wrap--code">
            <Hash aria-hidden="true" />
            <input
              id="invite-code"
              name="inviteCode"
              inputMode="numeric"
              minLength={6}
              maxLength={6}
              spellCheck={false}
              placeholder="123456"
              required
            />
          </div>
        </div>
        <FormMessage {...joinState} />
        <SubmitButton className="button--secondary button--wide" pendingLabel="Finder klan...">Tilmeld mig</SubmitButton>
      </form>
    </div>
  );
}
