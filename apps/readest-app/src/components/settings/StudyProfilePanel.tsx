import './settings.css';
/**
 * Settings → Study (Workbench 2.x W2.4) — the reader's own account of how
 * they like to learn. Every field is optional; leave everything unset and
 * the professor teaches you as he finds you. Stored locally per reader
 * (app-data dir) — nothing leaves the machine.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { BoxedList, SectionTitle, SettingsRow, SettingsSelect, SettingsInput } from './primitives';
import {
  emptyProfile,
  loadProfileCurrent,
  saveProfile,
  PROFILE_PACES,
  PROFILE_PROBE_MAX,
  PROFILE_VOICES,
  type LearnerProfile,
  type ProfilePace,
  type ProfileVoice,
} from '@/services/professor/learnerProfile';
import { slugifyConcept } from '@/services/professor/annotations';
import type { SettingsPanelPanelProp } from './SettingsDialog';

const BLOOM_NAMES = [
  '',
  'Remembering',
  'Understanding',
  'Applying',
  'Analyzing',
  'Evaluating',
  'Creating',
];

const StudyProfilePanel: React.FC<SettingsPanelPanelProp> = ({ onRegisterReset }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [profile, setProfile] = useState<LearnerProfile>(emptyProfile);
  const [conceptDraft, setConceptDraft] = useState('');
  const appServiceRef = useRef(appService);
  appServiceRef.current = appService;

  // One write-through per change; normalizeProfile collapses duplicates and
  // drops invalid fields on the way in, so the file is always clean.
  const save = (next: LearnerProfile) => {
    setProfile(next);
    const service = appServiceRef.current;
    if (service) void saveProfile(service, next).catch(() => undefined);
  };

  useEffect(() => {
    let live = true;
    void loadProfileCurrent().then((p) => {
      if (live) setProfile(p);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    onRegisterReset(() => {
      setProfile(emptyProfile());
      const service = appServiceRef.current;
      if (service) void saveProfile(service, emptyProfile()).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPace = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pace = e.target.value as ProfilePace | '';
    save({ ...profile, ...(pace ? { pace } : { pace: undefined }) });
  };
  const setProbe = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const probe_level = e.target.value ? Number(e.target.value) : undefined;
    save({ ...profile, probe_level });
  };
  const setVoice = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const voice = e.target.value as ProfileVoice | '';
    save({ ...profile, ...(voice ? { voice } : { voice: undefined }) });
  };

  const addConcept = () => {
    const slug = slugifyConcept(conceptDraft);
    setConceptDraft('');
    if (!slug) return;
    const owned = [...new Set([...(profile.owned_concepts ?? []), slug])];
    save({ ...profile, owned_concepts: owned });
  };
  const removeConcept = (slug: string) => {
    save({ ...profile, owned_concepts: (profile.owned_concepts ?? []).filter((c) => c !== slug) });
  };

  const owned = profile.owned_concepts ?? [];
  const defaultOption = { value: '', label: _('Default') };

  return (
    <div className='flex flex-col gap-6 px-4 py-4'>
      <BoxedList title={_('Pace of study')}>
        <SettingsRow label={_('Pace of study')}>
          <SettingsSelect
            value={profile.pace ?? ''}
            onChange={setPace}
            options={[
              defaultOption,
              ...PROFILE_PACES.map((pace) => ({
                value: pace,
                label:
                  pace === 'deliberate'
                    ? _('Deliberate — room to think')
                    : pace === 'steady'
                      ? _('Steady — neither rushed nor lingering')
                      : _('Swift — keep it tight'),
              })),
            ]}
            ariaLabel={_('Pace of study')}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('How far the professor probes')}>
        <SettingsRow label={_('How far the professor probes')}>
          <SettingsSelect
            value={profile.probe_level !== undefined ? String(profile.probe_level) : ''}
            onChange={setProbe}
            options={[
              defaultOption,
              ...Array.from({ length: PROFILE_PROBE_MAX }, (__unused, i) => {
                const n = i + 1;
                return { value: String(n), label: `${n} — ${_(BLOOM_NAMES[n] ?? '')}` };
              }),
            ]}
            ariaLabel={_('How far the professor probes')}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Voice of instruction')}>
        <SettingsRow label={_('Voice of instruction')}>
          <SettingsSelect
            value={profile.voice ?? ''}
            onChange={setVoice}
            options={[
              defaultOption,
              ...PROFILE_VOICES.map((voice) => ({
                value: voice,
                label:
                  voice === 'formal'
                    ? _('Formal — precise, no familiarity')
                    : voice === 'plain'
                      ? _('Plain — across the desk')
                      : _('Playful — wit welcome'),
              })),
            ]}
            ariaLabel={_('Voice of instruction')}
          />
        </SettingsRow>
      </BoxedList>

      <div>
        <SectionTitle className='mb-2'>{_('Concepts you already own')}</SectionTitle>
        <div className='settings-card eink-bordered divide-ink divide-y ps-4'>
          {owned.length === 0 ? (
            <div className='flex min-h-14 items-center'>
              <span className='text-ink/65 text-[0.85em]'>{_('Nothing set yet')}</span>
            </div>
          ) : (
            owned.map((slug) => (
              <SettingsRow key={slug} label={slug.replace(/_/g, ' ')}>
                <button
                  type='button'
                  className='text-mutedink hover:text-stamp text-xs'
                  aria-label={_('Remove {{concept}}', { concept: slug.replace(/_/g, ' ') })}
                  onClick={() => removeConcept(slug)}
                >
                  ✕
                </button>
              </SettingsRow>
            ))
          )}
          <SettingsRow label={_('Add a concept')} asLabel={false}>
            <div className='flex max-w-[60%] items-center gap-2'>
              <SettingsInput
                type='text'
                value={conceptDraft}
                placeholder={_('Add a concept')}
                aria-label={_('Add a concept')}
                onChange={(e) => setConceptDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') addConcept();
                }}
              />
              <button
                type='button'
                className='text-mutedink hover:text-stamp text-xs'
                onClick={addConcept}
              >
                {_('Add')}
              </button>
            </div>
          </SettingsRow>
        </div>
      </div>

      <p className='text-ink/65 ps-4 text-[0.8em] leading-relaxed'>
        {_('Leave everything unset and the professor teaches you as he finds you.')}
      </p>
    </div>
  );
};

export default StudyProfilePanel;
