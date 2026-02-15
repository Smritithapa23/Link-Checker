
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

  if (!isOverlay) {
    return (
      <div className="w-[360px] rounded-xl border border-gray-200 bg-white shadow-xl">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-black text-white w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm">
              LC
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">LinkClick</h1>
              <p className="text-[11px] text-gray-500">Link risk analyzer</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full border border-gray-300 text-gray-700">
            ACTIVE
          </span>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-700">
            Right-click any link and choose <span className="font-semibold">Verify with LinkClick</span>.
          </p>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500 mb-2">How results are shown</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-700">Risk Score</span>
              <span className="font-semibold text-gray-900">0 to 10</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-gray-700">Risk Class</span>
              <span className="font-semibold text-gray-900">Low / Medium / High</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-md border border-green-300 bg-green-50 px-2 py-1 text-center text-green-700">Safe</div>
            <div className="rounded-md border border-yellow-300 bg-yellow-50 px-2 py-1 text-center text-yellow-700">Suspicious</div>
            <div className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-center text-red-700">Danger</div>
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
