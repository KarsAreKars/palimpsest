import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { MdCheckCircle, MdCheckCircleOutline } from 'react-icons/md';
import {
  LiaCloudUploadAltSolid,
  LiaCloudDownloadAltSolid,
  LiaHeadphonesSolid,
  LiaInfoCircleSolid,
} from 'react-icons/lia';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { navigateToLogin } from '@/utils/nav';
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { isFeedBook } from '@/services/rss/feedBookUrl';
import { isAudiobook } from '@/utils/audiobook';
import { formatAuthors, formatDescription, formatSeries } from '@/utils/book';
import { formatCompactTime } from '@/utils/time';
import { INDETERMINATE_PROGRESS } from '@/utils/transfer';
import BookCover from '@/components/BookCover';
import { ClothCover } from '@/components/apothecary';
import { useExtractionStatus } from '@/services/hpub/useExtractionStatus';

interface BookItemProps {
  book: Book;
  mode: LibraryViewModeType;
  coverFit: LibraryCoverFitType;
  isSelectMode: boolean;
  bookSelected: boolean;
  transferProgress: number | null;
  /** The book's position in the catalogue (1-based) — typed on the plate. */
  plateNumber?: number;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  showBookDetailsModal: (book: Book) => void;
  showTimeRemaining: boolean;
}

const BookItem: React.FC<BookItemProps> = ({
  book,
  mode,
  coverFit,
  isSelectMode,
  bookSelected,
  transferProgress,
  plateNumber,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const iconSize15 = useResponsiveSize(15);

  const [, setCoverAspect] = useState<number | null>(null);
  useEffect(() => {
    setCoverAspect(null);
  }, [book.hash, book.metadata?.coverImageUrl, book.coverImageUrl]);

  // Real cover art when the book has it; cloth + typed label otherwise.
  const hasCoverArt = !!(book.metadata?.coverImageUrl || book.coverImageUrl);

  // The catalogue plate: covers are always cropped to a uniform 2:3 frame —
  // every book carries equal visual weight. The fit path is gone from the grid.
  const seriesText = formatSeries(book.metadata?.series, book.metadata?.seriesIndex);
  const progressPercentage =
    book.progress && book.progress[1] > 0
      ? Math.max(0, Math.min(100, Math.round((book.progress[0] / book.progress[1]) * 100)))
      : null;
  const plateLabel = plateNumber ? `№ ${String(plateNumber).padStart(3, '0')}` : '';

  // One condition drives both the cover overlay and the hiding of the row's
  // transfer buttons, so the cover can never end up showing neither. The
  // entry is removed once the transfer settles, including at 100%.
  const isTransferring = transferProgress !== null;
  const isIndeterminate = transferProgress === INDETERMINATE_PROGRESS;

  // ABS books track progress in seconds, not pages, so the row shows a
  // duration/remaining-time label instead of ReadingProgress's page percent:
  // total length when unplayed, remaining time once started (mirrors the
  // scrubber's "-remaining" convention).
  const isAbsBook = isAudiobook(book);
  const isPodcastShow = book.absMediaType === 'podcast';
  const absDuration = book.duration ?? 0;
  const absCurrentTime = book.progress?.[0] ?? 0;
  const absTimeLabel =
    absCurrentTime > 0
      ? `-${formatCompactTime(Math.max(absDuration - absCurrentTime, 0))}`
      : formatCompactTime(absDuration);
  // A podcast show has no total duration or resume position of its own (those
  // live per-episode, a later task), so the row badges its episode count
  // instead of the duration/remaining-time label audiobooks get.
  const episodeCountLabel = _('{{count}} episodes', { count: book.episodeCount ?? 0 });

  const extractionStatus = useExtractionStatus(book);
  const extractionBadge = useMemo(() => {
    if (book.format !== 'PDF' || !extractionStatus || extractionStatus.status === 'ok') return null;
    if (extractionStatus.status === 'running') {
      const label = extractionStatus.stage
        ? _('Converting ({{stage}}/6): {{detail}}', {
            stage: extractionStatus.stage,
            detail: extractionStatus.stageDetail ?? '',
          })
        : _('Queued for conversion…');
      return { tone: 'running' as const, label, detail: '' };
    }
    if (extractionStatus.status === 'rejected') {
      const label =
        extractionStatus.reason === 'scanned'
          ? _('No text layer: scanned PDF')
          : _('No text layer: quality gate');
      return { tone: 'failed' as const, label, detail: extractionStatus.detail ?? '' };
    }
    return {
      tone: 'failed' as const,
      label: _('Text layer failed'),
      detail: extractionStatus.detail ?? '',
    };
  }, [book.format, extractionStatus, _]);

  return (
    <div
      role='none'
      className={clsx(
        'book-item flex',
        mode === 'grid' && 'h-full flex-col justify-start',
        mode === 'list' && 'min-h-28 flex-row gap-4 overflow-hidden',

        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={clsx(
          'bookitem-main relative flex justify-center overflow-hidden',
          mode === 'grid' && 'plate plate-notch aspect-[2/3] items-end',
          mode === 'list' && 'min-w-20 items-center',
        )}
      >
        {/* Apothecary: real cover art is a must — the cloth + typed label is
            the fallback for books that have none. */}
        {hasCoverArt ? (
          <BookCover
            mode={mode}
            book={book}
            coverFit={mode === 'grid' ? 'crop' : coverFit}
            showSpine={mode === 'list' && settings.librarySkeuomorphicCovers}
            imageClassName={clsx(
              mode === 'grid' ? 'rounded-none' : 'shadow-[var(--lift-shadow)] rounded-sm',
            )}
            onAspectRatioChange={setCoverAspect}
          />
        ) : (
          <ClothCover
            title={book.title}
            author={formatAuthors(book.author, book.primaryLanguage) || undefined}
            size='lg'
            className='h-full w-full'
          />
        )}
        {isTransferring && (
          // E-ink cannot render a translucent wash — it dithers over the cover
          // art — and has no shadows, so the scrim becomes a solid base-100
          // panel with a 1px base-content border and ink-colored content.
          <div
            className='absolute inset-0 flex items-center justify-center bg-black/40 eink:border eink:border-ink eink:bg-paper'
            role='progressbar'
            aria-label={_('Downloading {{title}}', { title: book.title })}
            aria-valuenow={isIndeterminate ? undefined : Math.round(transferProgress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {isIndeterminate ? (
              <span className='library-spinner library-spinner-md' />
            ) : (
              <span className='eink:text-ink text-sm font-semibold text-white not-eink:drop-shadow-sm'>
                {Math.round(transferProgress)}%
              </span>
            )}
          </div>
        )}
        {bookSelected && (
          <div className='absolute inset-0 bg-black opacity-30 transition-opacity duration-300'></div>
        )}
        {extractionBadge && (
          // Palimpsest: the text layer is the book's machine half (plan §3).
          // Surface its build state on the cover so a PDF import never
          // silently lacks its content.md — running, failed, or rejected.
          <div
            className={clsx(
              'absolute bottom-1 left-1 right-1 flex items-center gap-1 px-1.5 py-1',
              'text-[0.6rem] leading-tight text-white',
              extractionBadge.tone === 'running' && 'bg-black/60',
              extractionBadge.tone === 'failed' && 'bg-stamp/85',
            )}
            title={extractionBadge.detail}
          >
            {extractionBadge.tone === 'running' && (
              <span className='library-spinner library-spinner-xs shrink-0' />
            )}
            <span className='line-clamp-2'>{extractionBadge.label}</span>
          </div>
        )}
        {isSelectMode && (
          <div className='absolute bottom-1 right-1'>
            {bookSelected ? (
              <MdCheckCircle className='fill-[var(--stamp)]' />
            ) : (
              <MdCheckCircleOutline className='fill-[var(--faint)] drop-shadow-sm' />
            )}
          </div>
        )}
      </div>
      {mode === 'grid' && (
        // The specimen label: three lines under the plate, outside the frame.
        <div className='catalogue-label flex w-full flex-col gap-[3px] pt-2'>
          <h4 className='plate-title line-clamp-2 text-[13px] leading-tight' title={book.title}>
            {book.title}
          </h4>
          <p className='plate-meta truncate leading-tight'>
            {[
              formatAuthors(book.author, book.primaryLanguage),
              progressPercentage !== null ? `${progressPercentage}%` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className='plate-num'>{[plateLabel, book.format].filter(Boolean).join(' · ')}</p>
        </div>
      )}
      {mode === 'list' && (
        <div className='flex w-full flex-col gap-1 py-0'>
          <div className='min-w-0 flex-1'>
            <h4 className='typed overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-ink'>
              {book.title}
            </h4>
            <p className='text-ink line-clamp-1 text-sm'>
              {formatAuthors(book.author, book.primaryLanguage) || ''}
            </p>
          </div>
          {seriesText && <p className='text-ink line-clamp-1 text-sm'>{seriesText}</p>}
          <h4 className='text-ink line-clamp-1 text-sm'>
            {formatDescription(book.metadata?.description)}
          </h4>
          <div
            className={clsx(
              'flex items-center',
              book.progress || book.readingStatus || isAbsBook ? 'justify-between' : 'justify-end',
            )}
            style={{
              height: `${iconSize15}px`,
              minHeight: `${iconSize15}px`,
            }}
          >
            {isAbsBook ? (
              <div className='text-mutedink flex min-w-0 justify-between text-xs' role='status'>
                <span className='truncate tabular-nums'>
                  {isPodcastShow ? episodeCountLabel : absTimeLabel}
                </span>
              </div>
            ) : (
              (book.progress || book.readingStatus) && (
                <div className='w-full'>
                  {book.progress && book.progress[1] > 1 && book.readingStatus !== 'finished' && (
                    <div className='progress-track mb-1 w-full'>
                      <div
                        className='progress-fill'
                        style={{
                          width: `${Math.min(100, Math.round((book.progress[0] / book.progress[1]) * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                  <div className='typed text-mutedink text-[8.5px]'>
                    {progressPercentage !== null ? `${progressPercentage}%` : ''}
                  </div>
                </div>
              )
            )}
            <div className='flex shrink-0 items-center justify-center gap-x-2'>
              {!appService?.isMobile && (
                <button
                  aria-label={_('Show Book Details')}
                  className='show-detail-button -m-2 p-2 sm:opacity-0 sm:group-hover:opacity-100'
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    showBookDetailsModal(book);
                  }}
                >
                  <div className='pt-[2px] sm:pt-[1px]'>
                    <LiaInfoCircleSolid size={iconSize15} />
                  </div>
                </button>
              )}
              {(book.hasNarration || isAbsBook) && (
                <div
                  className='pt-[2px] sm:pt-[1px]'
                  title={isAbsBook ? _('Audiobook') : _('Includes narration')}
                  aria-label={isAbsBook ? _('Audiobook') : _('Includes narration')}
                >
                  <LiaHeadphonesSolid size={iconSize15} />
                </div>
              )}
              {isTransferring
                ? null
                : !isFeedBook(book) &&
                  !isAudiobook(book) &&
                  (!book.uploadedAt || (book.uploadedAt && !book.downloadedAt)) && (
                    <button
                      aria-label={!book.uploadedAt ? _('Upload Book') : _('Download Book')}
                      className='show-cloud-button -m-2 p-2'
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (!user) {
                          navigateToLogin(router);
                          return;
                        }
                        if (!book.uploadedAt) {
                          handleBookUpload(book);
                        } else if (!book.downloadedAt) {
                          handleBookDownload(book, { queued: true });
                        }
                      }}
                    >
                      {!book.uploadedAt && isReadestCloudStorageActive(settings) && (
                        <LiaCloudUploadAltSolid size={iconSize15} />
                      )}
                      {book.uploadedAt && !book.downloadedAt && (
                        <LiaCloudDownloadAltSolid size={iconSize15} />
                      )}
                    </button>
                  )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookItem;
