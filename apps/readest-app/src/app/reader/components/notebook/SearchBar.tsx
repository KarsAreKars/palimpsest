import React, { useEffect, useRef, useState } from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';

import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { BookNote } from '@/types/book';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { filterBooknotes } from '@/app/reader/utils/annotatorUtil';

interface SearchBarProps {
  isVisible: boolean;
  bookKey: string;
  searchTerm: string;
  onSearchResultChange: (results: BookNote[] | null) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({
  isVisible,
  bookKey,
  searchTerm: term,
  onSearchResultChange,
}) => {
  const _ = useTranslation();
  const { getConfig } = useBookDataStore();
  const [searchTerm, setSearchTerm] = useState(term);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const iconSize16 = useResponsiveSize(16);
  const iconSize12 = useResponsiveSize(12);

  useEffect(() => {
    handleSearchTermChange(searchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    setSearchTerm(term);
    handleSearchTermChange(term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isVisible]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && inputRef.current) {
        inputRef.current.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    searchTimeout.current = setTimeout(() => {
      handleSearchTermChange(value);
    }, 300);
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    handleSearchTermChange('');
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleSearchTermChange = (term: string) => {
    if (term.trim().length >= 1) {
      handleSearch(term);
    } else {
      resetSearch();
    }
  };

  const handleSearch = (term: string) => {
    const config = getConfig(bookKey);
    if (!config) {
      resetSearch();
      return;
    }

    const { booknotes: allNotes = [] } = config;
    const results = filterBooknotes(allNotes, { kind: 'all', query: term });
    onSearchResultChange(results);
  };

  const resetSearch = () => {
    onSearchResultChange(null);
  };

  return (
    <div className='relative px-3 py-2'>
      <div className='border-ink bg-paperlight focus-within:border-stamp flex h-8 items-center rounded-full border transition-colors'>
        <div className='pl-3'>
          <FaSearch size={iconSize16} className='text-mutedink' />
        </div>

        <input
          ref={inputRef}
          type='text'
          value={searchTerm}
          spellCheck={false}
          onChange={handleInputChange}
          placeholder={_('Search excerpts...')}
          className='w-full bg-transparent p-2 font-sans text-sm font-light focus:outline-none'
        />

        {searchTerm && (
          <div className='border-ink bg-paper flex h-8 w-8 items-center border-s'>
            <button
              onClick={handleClearSearch}
              className='flex h-8 w-8 items-center justify-center text-mutedink transition-colors hover:text-ink focus-visible:outline-offset-2 focus-visible:outline-stamp focus-visible:outline-2'
            >
              <FaTimes size={iconSize12} className='text-mutedink' />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
