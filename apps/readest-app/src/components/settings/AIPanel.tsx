import './settings.css';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

const AIPanel: React.FC = () => {
  const _ = useTranslation();

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full px-4'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('AI Assistant')}</h2>
        <p className='text-ink/70 text-sm leading-relaxed'>
          {_('The endpoint the Prof talks to is configured under Integrations, The Prof.')}
        </p>
      </div>
    </div>
  );
};

export default AIPanel;
