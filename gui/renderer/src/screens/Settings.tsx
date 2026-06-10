import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useStatus } from '../hooks/useStatus.js';
import type { Profile, HouseholdMember } from '../../../../core/profile.js';
import { KeyHints } from '../components/KeyHints.js';
import styles from './Settings.module.css';

const MIN_YEAR = 1900;

function validYear(y: number): boolean {
  return Number.isInteger(y) && y >= MIN_YEAR && y <= new Date().getFullYear();
}

function MemberRow({
  label,
  member,
  onChange,
  onRemove,
}: {
  label: string;
  member: HouseholdMember;
  onChange: (m: HouseholdMember) => void;
  onRemove?: () => void;
}) {
  const yearOk = member.birthYear === 0 || validYear(member.birthYear);
  return (
    <div className={styles.memberRow}>
      <span className={styles.memberLabel}>{label}</span>
      <input
        value={member.name}
        placeholder="Name"
        onChange={(e) => onChange({ ...member, name: e.target.value })}
      />
      <input
        className={`${styles.yearInput} ${yearOk ? '' : styles.yearBad}`}
        value={member.birthYear || ''}
        placeholder="Birth year"
        inputMode="numeric"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
          onChange({ ...member, birthYear: digits ? parseInt(digits, 10) : 0 });
        }}
      />
      {onRemove ? (
        <button className={styles.removeBtn} onClick={onRemove}>
          remove
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

export function Settings() {
  const { showStatus, statusEl } = useStatus();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api.profile.loadProfile().then((p) => {
      setProfile(p ?? { self: { name: '', birthYear: 0 }, children: [] });
      setLoaded(true);
    });
  }, []);

  if (!loaded || !profile) return <p className="dim">Loading…</p>;

  const members: HouseholdMember[] = [profile.self, ...(profile.spouse ? [profile.spouse] : []), ...profile.children];
  const valid =
    profile.self.name.trim() !== '' &&
    members.every((m) => m.name.trim() !== '' && validYear(m.birthYear));

  async function save() {
    if (!profile || !valid) return;
    await api.profile.saveProfile({
      self: { name: profile.self.name.trim(), birthYear: profile.self.birthYear },
      ...(profile.spouse ? { spouse: { name: profile.spouse.name.trim(), birthYear: profile.spouse.birthYear } } : {}),
      children: profile.children.map((c) => ({ name: c.name.trim(), birthYear: c.birthYear })),
    });
    showStatus('Profile saved');
  }

  return (
    <div className={styles.screen}>
      <KeyHints hints="[1-9·0] screens" />
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.panel}>
        <h2>Household</h2>
        <p className="dim">
          Used for age-aware planning (retirement timelines, college horizons) and account-owner assignment.
        </p>

        <MemberRow label="You" member={profile.self} onChange={(m) => setProfile({ ...profile, self: m })} />

        {profile.spouse ? (
          <MemberRow
            label="Spouse"
            member={profile.spouse}
            onChange={(m) => setProfile({ ...profile, spouse: m })}
            onRemove={() => {
              const { spouse: _removed, ...rest } = profile;
              setProfile(rest);
            }}
          />
        ) : (
          <button
            className={styles.addBtn}
            onClick={() => setProfile({ ...profile, spouse: { name: '', birthYear: 0 } })}
          >
            + Add spouse / partner
          </button>
        )}

        {profile.children.map((child, i) => (
          <MemberRow
            key={i}
            label={`Child ${i + 1}`}
            member={child}
            onChange={(m) => setProfile({ ...profile, children: profile.children.map((c, j) => (j === i ? m : c)) })}
            onRemove={() => setProfile({ ...profile, children: profile.children.filter((_, j) => j !== i) })}
          />
        ))}
        <button
          className={styles.addBtn}
          onClick={() => setProfile({ ...profile, children: [...profile.children, { name: '', birthYear: 0 }] })}
        >
          + Add child
        </button>

        <div className={styles.actions}>
          {!valid && <span className="dim">Every member needs a name and a valid birth year.</span>}
          <button className={styles.btnPrimary} onClick={() => void save()} disabled={!valid}>
            Save profile
          </button>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Configuration</h2>
        <p className="dim">
          API keys, Plaid credentials, and data location live in <span className="num">~/.fungible/.env</span>. The
          first-run setup wizard is available via <span className="num">fungible --setup</span> in a terminal.
        </p>
      </section>

      {statusEl}
    </div>
  );
}
