import './settings.css';
import clsx from 'clsx';
import React, { useState } from 'react';
import { MdAdd, MdDelete } from 'react-icons/md';
import { IoMdCloseCircleOutline } from 'react-icons/io';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { useFileSelector } from '@/hooks/useFileSelector';
import { saveViewSettings } from '@/helpers/settings';
import { CustomFont, mountCustomFont } from '@/styles/fonts';
import { queueReplicaBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import { Tips } from './primitives';

interface CustomFontsProps {
  bookKey: string;
  onBack: () => void;
}

type FontFamily = {
  name: string;
  fonts: CustomFont[];
};

const CustomFonts: React.FC<CustomFontsProps> = ({ bookKey, onBack }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const {
    fonts: customFonts,
    addFont,
    loadFont,
    removeFont,
    getAvailableFonts,
    saveCustomFonts,
  } = useCustomFontStore();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  // null = idle, true = importing (spinner), { family } = done importing (show font name).
  // The card stays mounted throughout — only its content changes.
  const [importingFont, setImportingFont] = useState<true | { family: string } | null>(null);

  const { selectFiles } = useFileSelector(appService, _);

  const currentDefaultFont =
    viewSettings.defaultFont.toLowerCase() === 'serif' ? 'serif' : 'sans-serif';

  const currentFontFamily =
    currentDefaultFont === 'serif' ? viewSettings.serifFont : viewSettings.sansSerifFont;

  const handleImportFont = () => {
    selectFiles({ type: 'fonts', multiple: true }).then(async (result) => {
      if (result.error || result.files.length === 0) return;
      setImportingFont(true);
      try {
        for (const selectedFile of result.files) {
          const fontInfo = await appService?.importFont(selectedFile.path || selectedFile.file);
          if (!fontInfo) continue;

          // Replace the spinner with the resolved font family name in-place,
          // so the card stays at the same grid position without layout jump.
          setImportingFont({ family: fontInfo.family });

          const customFont = addFont(fontInfo.path, {
            name: fontInfo.name,
            family: fontInfo.family,
            style: fontInfo.style,
            weight: fontInfo.weight,
            variable: fontInfo.variable,
            contentId: fontInfo.contentId,
            bundleDir: fontInfo.bundleDir,
            byteSize: fontInfo.byteSize,
          });
          console.log('Added custom font:', customFont);
          if (customFont && !customFont.error) {
            const loadedFont = await loadFont(envConfig, customFont.id);
            mountCustomFont(document, loadedFont);
            if (appService) void queueReplicaBinaryUpload('font', customFont, appService);
          }
        }
        saveCustomFonts(envConfig);
      } finally {
        // Keep the card visible — it now shows the font family name.
        // availableFamilies will pick it up on next render and the
        // importingFont card naturally becomes a regular font card.
        // We clear importingFont after a tick so availableFamilies
        // has a chance to include the new font first.
        setTimeout(() => setImportingFont(null), 0);
      }
    });
  };

  const handleDeleteFamily = (family: FontFamily) => {
    for (const font of family.fonts) {
      if (font) {
        if (removeFont(font.id)) {
          appService?.deleteFont(font);
          saveCustomFonts(envConfig);
          if (getAvailableFonts().length === 0) {
            setIsDeleteMode(false);
          }
        }
      }
    }
  };

  const handleSelectFamily = (family: FontFamily) => {
    if (currentDefaultFont === 'serif') {
      saveViewSettings(envConfig, bookKey, 'serifFont', family.name);
    } else {
      saveViewSettings(envConfig, bookKey, 'sansSerifFont', family.name);
    }
  };

  const toggleDeleteMode = () => {
    setIsDeleteMode(!isDeleteMode);
  };

  const getAvailableFamilies = (fonts: CustomFont[]): FontFamily[] => {
    const familyMap = new Map<string, string[]>();

    for (const font of fonts) {
      const family = font.family || font.name;
      if (!familyMap.has(family)) {
        familyMap.set(family, []);
      }
      familyMap.get(family)!.push(font.id);
    }

    return Array.from(familyMap.entries()).map(([family, ids]) => ({
      name: family,
      fonts: ids.map((id) => fonts.find((f) => f.id === id)!).filter((f): f is CustomFont => !!f),
    }));
  };

  const availableFonts = customFonts
    .filter((font) => !font.deletedAt)
    .sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));

  // Exclude the font that's currently shown by the importingFont card so
  // we don't render two cards for the same font family.
  const importingFamily =
    importingFont && typeof importingFont === 'object' ? importingFont.family : null;
  const visibleFonts = importingFamily
    ? availableFonts.filter((f) => (f.family || f.name) !== importingFamily)
    : availableFonts;

  const availableFamilies = getAvailableFamilies(visibleFonts);

  return (
    <div className='w-full'>
      <div className='mb-6 flex h-8 items-center justify-between'>
        <div className='py-1'>
          <ul>
            <li>
              <button className='font-semibold' onClick={onBack}>
                {_('Font')}
              </button>
            </li>
            <li className='font-medium'>{_('Custom Fonts')}</li>
          </ul>
        </div>
        {availableFonts.length > 0 && (
          <button
            onClick={toggleDeleteMode}
            className={`settings-btn settings-btn-sm text-ink gap-2`}
            title={isDeleteMode ? _('Cancel Delete') : _('Delete Font')}
          >
            {isDeleteMode ? (
              <>{_('Cancel')}</>
            ) : (
              <>
                <MdDelete className='h-4 w-4' />
                {_('Delete')}
              </>
            )}
          </button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-4'>
        {/* Import Font — quiet outlined card matching the surrounding font
 family cards' visual weight (border-ink bg, hover lifts to
 base-200). Replaces the old loud `border-stamp/50 text-stamp`
            CTA styling. eink-bordered keeps the boundary visible in eink. */}
        <button
          type='button'
          onClick={handleImportFont}
          className={clsx(
            'bg-paper eink-bordered group flex h-12 items-center justify-center gap-2 rounded-[2px]',
            'border-ink hover:border-ink hover:bg-paperlight/40 border',
            'text-ink text-sm font-medium',
            'transition-colors duration-150',
            'focus-visible:ring-stamp/40 focus-visible:outline-none focus-visible:ring-2',
          )}
        >
          <span
            className={clsx(
              // eink-inverted keeps the "+" legible on its dark badge (#4454).
              'eink-inverted',
              'flex h-5 w-5 items-center justify-center rounded-full',
              'bg-paperlight text-mutedink',
              'transition-colors duration-150',
              'group-hover:bg-ink group-hover:text-paper',
            )}
          >
            <MdAdd className='h-3.5 w-3.5' />
          </span>
          <span className='line-clamp-1'>{_('Import Font')}</span>
        </button>

        {importingFont && (
          <div className='settings-card h-12'>
            <div className='flex items-center justify-center p-2'>
              {typeof importingFont === 'object' ? (
                <div
                  style={{ fontFamily: `"${importingFont.family}", sans-serif`, fontWeight: 400 }}
                  className='text-ink line-clamp-1 break-all'
                >
                  {importingFont.family}
                </div>
              ) : (
                <div className='flex items-center gap-2 text-sm text-mutedink'>
                  <svg className='h-4 w-4 animate-spin' viewBox='0 0 24 24' fill='none'>
                    <circle
                      className='opacity-25'
                      cx='12'
                      cy='12'
                      r='10'
                      stroke='currentColor'
                      strokeWidth='4'
                    />
                    <path
                      className='opacity-75'
                      fill='currentColor'
                      d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
                    />
                  </svg>
                  <span>{_('Importing...')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {availableFamilies.map((family) => (
          <div
            role='none'
            key={family.name}
            className={clsx(
              'settings-card h-12',
              currentFontFamily === family.name
                ? // eink-bordered: bg-stamp/50 dodges the eink normalizer, so
                  // without it the selected card is black-on-black (#4454).
                  'border-stamp/50 bg-stamp/50 eink-bordered'
                : `border-ink bg-paper ${isDeleteMode ? '' : 'cursor-pointer'}`,
            )}
            onClick={!isDeleteMode ? () => handleSelectFamily(family) : undefined}
            title={family.fonts.map((f) => f.name).join('\n')}
          >
            <div className='flex items-center justify-center p-2'>
              <div
                style={{
                  fontFamily: `"${family.name}", sans-serif`,
                  fontWeight: 400,
                }}
                className='text-ink line-clamp-1 break-all'
              >
                {family.name}
              </div>
              {isDeleteMode && (
                <button
                  onClick={() => handleDeleteFamily(family)}
                  className='settings-btn settings-btn-xs absolute right-[-10px] top-[-10px] h-6 min-h-0 w-6 p-0 hover:bg-transparent'
                  title={_('Delete Font')}
                >
                  <IoMdCloseCircleOutline className='text-ink/75 h-6 w-6' />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Tips className='mt-6'>
        <li>{_('Supported font formats: .ttf, .otf, .woff, .woff2')}</li>
        <li>{_('Custom fonts can be selected from the Font Face menu')}</li>
      </Tips>
    </div>
  );
};

export default CustomFonts;
