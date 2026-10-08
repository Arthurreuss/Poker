// Einstellungen → „Avatar“ (WP-032): eines der festen Motive wählen oder keins. Wird sofort gespeichert
// (`PUT /api/me/avatar`) und ist für alle Mitspieler sichtbar (Tisch, Rangliste, Profil).
import { AVATAR_IDS, type AvatarId } from '@poker/engine/protocol';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { AVATAR_ART } from '../avatars/art';
import { Avatar } from '../avatars/Avatar';
import { errorMessage } from '../pages/AuthForm';
import pageStyles from '../pages/Page.module.css';
import styles from './AvatarPicker.module.css';

const CHOICES: readonly (AvatarId | null)[] = [null, ...AVATAR_IDS];

export function AvatarPicker() {
  const { user, setAvatar } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (user === null) return null;
  const current = user.avatar;

  const choose = async (avatar: AvatarId | null) => {
    if (avatar === current || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setAvatar(avatar);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className={pageStyles.panel} aria-busy={saving}>
      <legend>Avatar</legend>
      <div className={styles.grid}>
        {CHOICES.map((id) => {
          const label = id === null ? 'Kein Avatar' : AVATAR_ART[id].label;
          return (
            <label key={id ?? 'none'} className={styles.choice} title={label}>
              <input
                type="radio"
                name="avatar"
                value={id ?? ''}
                className={styles.input}
                checked={current === id}
                disabled={saving}
                aria-label={label}
                onChange={() => {
                  void choose(id);
                }}
              />
              <Avatar avatar={id} name={user.username} decorative className={styles.avatar} />
            </label>
          );
        })}
      </div>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={pageStyles.muted}>
        Sichtbar für alle Mitspieler am Tisch, in der Rangliste und im Profil. Ohne Avatar steht dort dein
        Anfangsbuchstabe.
      </p>
    </fieldset>
  );
}
