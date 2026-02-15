
// Add global declaration for chrome to satisfy TypeScript compiler
declare var chrome: any;

import React, { useState, useEffect } from 'react';
import ShieldNotification from './components/ShieldNotification';
import { VerificationResult, ExtensionMessage } from './types';

interface AppProps {
  isOverlay?: boolean;
}

const App: React.FC<AppProps> = ({ isOverlay = false }) => {
  const [activeResult, setActiveResult] = useState<VerificationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      chrome.storage.sync.get(['linkClickEnabled'], (data: { linkClickEnabled?: boolean }) => {
        const enabled = data.linkClickEnabled ?? true;
        setIsEnabled(enabled);
        if (data.linkClickEnabled === undefined) {
          chrome.storage.sync.set({ linkClickEnabled: true });
        }
      });
    }
  }, []);

  useEffect(() => {
    const handleMessage = (message: ExtensionMessage) => {
      if (message.type === 'VERIFICATION_START') {
        setIsLoading(true);
        setActiveResult(null);
      } else if (message.type === 'VERIFICATION_RESULT') {
        setIsLoading(false);
        setActiveResult(message.payload);
      }
    };

    // Listen for messages from background script
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener(handleMessage);
    }

    return () => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onMessage.removeListener(handleMessage);
      }
    };
  }, []);

  const clearState = () => {
    setActiveResult(null);
    setIsLoading(false);
  };

  const toggleEnabled = () => {
    const next = !isEnabled;
    setIsEnabled(next);
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      chrome.storage.sync.set({ linkClickEnabled: next });
    }
  };

  if (!isOverlay) {
    return (
      <div className="w-[380px] max-w-[96vw] rounded-xl border border-gray-200 bg-white shadow-xl">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-black text-white w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm">
              LC
            </div>
            <div>
              <h1 className="text-[19px] leading-tight font-bold tracking-tight text-gray-900">LinkClick</h1>
              <p className="text-[11px] font-medium tracking-wide uppercase text-gray-500">Link Rating Engine</p>
            </div>
          </div>
          <button
            onClick={toggleEnabled}
            className={`text-[10px] font-semibold tracking-wide px-2.5 py-1 rounded-full border ${
              isEnabled
                ? 'border-green-600 bg-green-50 text-green-700'
                : 'border-gray-400 bg-gray-100 text-gray-600'
            }`}
          >
            {isEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="px-[5%] py-[5%]">
          <div className="space-y-4">
          {!isEnabled && (
            <div className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-3 text-[12px] leading-relaxed text-gray-700">
              LinkClick is currently off. Right-click scans are disabled.
            </div>
          )}
          <p className="text-[14px] leading-relaxed text-gray-700 break-words">
            Right-click any link and choose <span className="font-semibold">Verify with LinkClick</span>.
          </p>

          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-[11px] font-semibold tracking-wider uppercase text-gray-500 mb-2">How Results Work</p>
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-gray-700">Rating</span>
              <span className="font-bold text-gray-900">1 to 10</span>
            </div>
            <div className="flex items-center justify-between text-[13px] mt-2">
              <span className="text-gray-700">Interpretation</span>
              <span className="font-medium text-gray-900">1 high risk, 10 low risk</span>
            </div>
          </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ShieldNotification 
      result={activeResult} 
      isLoading={isLoading} 
      onClose={clearState} 
    />
  );
};

export default App;
