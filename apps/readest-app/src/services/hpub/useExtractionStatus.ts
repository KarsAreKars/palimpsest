/**
 * React binding for per-book text-layer extraction status. Reads the
 * persisted extraction.json once, then follows the extraction event bus so
 * a running job's completion updates the library card live.
 */
import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import type { Book } from '@/types/book';
import { onExtractionStatus, readExtractionStatus, type ExtractionStatus } from './extractService';

export const useExtractionStatus = (book: Book): ExtractionStatus | null => {
  const { appService } = useEnv();
  const [status, setStatus] = useState<ExtractionStatus | null>(null);

  useEffect(() => {
    if (!appService) return;
    let alive = true;
    void readExtractionStatus(appService, book).then((s) => {
      if (alive) setStatus(s);
    });
    const off = onExtractionStatus((hash, s) => {
      if (hash === book.hash) setStatus(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, [appService, book]); // eslint-disable-line react-hooks/exhaustive-deps

  return status;
};
