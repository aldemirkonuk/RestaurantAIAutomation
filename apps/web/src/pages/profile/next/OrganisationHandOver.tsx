/**
 * "Hand over your organisation" (F-750, S195). The last owner of an
 * organisation cannot delete their account: nobody could open a new location
 * in it again. This is the way out the delete refusal points to. The owner
 * picks a member who owns one of the organisation's restaurants; that person
 * becomes the owner and the giver stays on as a manager of it, keeping every
 * restaurant role. Drawn only for someone who owns an organisation.
 *
 * The gateway: `GET /auth/me/organisations` and
 * `POST /auth/me/organisations/:id/hand-over` (auth.service.ts
 * `organisationsToHandOver`, `handOverOrganisation`). Handing over cannot be
 * taken back by the giver, so it asks for the same proof as deleting the
 * account (F-1347).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import { Btn, Card, Note, StatusLine } from './pf-ui';
import { SANS } from './pf-format';
import { StepUpField, useStepUpCode } from './StepUpCode';

export interface OwnedOrganisation {
  id: string;
  name: string;
  candidates: { userId: string; name: string; email: string | null }[];
}

export const OWNED_ORGANISATIONS_KEY = ['auth', 'me', 'organisations'] as const;

export function OrganisationHandOver() {
  const qc = useQueryClient();
  const owned = useQuery({
    queryKey: OWNED_ORGANISATIONS_KEY,
    queryFn: async () =>
      (await apiClient.get<{ organizations: OwnedOrganisation[] }>('/auth/me/organisations')).data.organizations,
    retry: false,
  });
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);
  const stepUp = useStepUpCode();

  const handOver = useMutation({
    mutationFn: async ({ orgId, toUserId }: { orgId: string; toUserId: string }) =>
      (
        await apiClient.post(`/auth/me/organisations/${orgId}/hand-over`, {
          toUserId,
          emailCode: stepUp.emailCode,
        })
      ).data,
  });

  if (owned.isError) {
    return (
      <Card title="Hand over your organisation">
        <StatusLine tone="error">
          Could not read whether you own an organisation — {getErrorMessage(owned.error)}
        </StatusLine>
      </Card>
    );
  }
  if (!owned.data || owned.data.length === 0) return null;

  const submit = (org: OwnedOrganisation, toUserId: string) => {
    if (armed !== org.id) {
      setArmed(org.id);
      return;
    }
    setArmed(null);
    setMsg(null);
    const who = org.candidates.find((c) => c.userId === toUserId)?.name ?? 'They';
    handOver.mutate(
      { orgId: org.id, toUserId },
      {
        onSuccess: () => {
          stepUp.reset();
          setMsg({
            tone: 'done',
            text: `${who} now owns ${org.name}. You stay on as a manager of it, with all your restaurant roles.`,
          });
          void qc.invalidateQueries({ queryKey: OWNED_ORGANISATIONS_KEY });
        },
        onError: (e) => {
          if (stepUp.asked(e)) return;
          setMsg({ tone: 'error', text: `${org.name} was NOT handed over — ${getErrorMessage(e)}` });
        },
      },
    );
  };

  return (
    <Card
      title="Hand over your organisation"
      lead="You opened this organisation, so only you can open new locations in it. Hand it to someone who owns one of its restaurants; you stay on as a manager. Your account can be deleted once nobody depends on it being yours."
    >
      {owned.data.map((org) => {
        const pick = chosen[org.id] ?? '';
        return (
          <div key={org.id} data-testid={`handover-${org.id}`} style={{ marginBottom: 12 }}>
            <label
              htmlFor={`pf-handover-${org.id}`}
              style={{ display: 'block', marginBottom: 4, fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}
            >
              {org.name}: hand it to
            </label>
            {org.candidates.length === 0 ? (
              <Note>
                Nobody else owns one of its restaurants yet. Make someone an owner of a restaurant on the Team page
                first, then they appear here.
              </Note>
            ) : (
              <>
                <select
                  id={`pf-handover-${org.id}`}
                  value={pick}
                  onChange={(e) => {
                    setArmed(null);
                    setChosen((c) => ({ ...c, [org.id]: e.target.value }));
                  }}
                  className="pf-focus"
                  style={{ marginBottom: 10, padding: '7px 9px', borderRadius: 8, fontFamily: SANS, fontSize: 13 }}
                >
                  <option value="">Choose a person</option>
                  {org.candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.email ? `${c.name} (${c.email})` : c.name}
                    </option>
                  ))}
                </select>
                <StepUpField id={`pf-handover-code-${org.id}`} stepUp={stepUp} />
                <div>
                  <Btn
                    emphasis="seal"
                    disabled={!pick || handOver.isPending || !stepUp.ready || stepUp.sending}
                    onClick={() => submit(org, pick)}
                  >
                    {handOver.isPending
                      ? 'Handing over…'
                      : armed === org.id
                        ? 'Click again to hand it over'
                        : 'Hand over'}
                  </Btn>
                </div>
              </>
            )}
          </div>
        );
      })}
      {msg && <StatusLine tone={msg.tone}>{msg.text}</StatusLine>}
    </Card>
  );
}
