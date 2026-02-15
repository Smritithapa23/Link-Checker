
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
      <div className="w-80 p-6 flex flex-col items-center bg-white">
        <div className="mb-4">
          <div className="bg-blue-600 p-3 rounded-full shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
        </div>
        <h1 className="text-xl font-bold text-gray-800">LinkClick</h1>
        <p className="text-center text-sm text-gray-500 mt-2">
          Your AI guardian for the web. Right-click any link and select "Verify with LinkClick" to check its safety.
        </p>
        <div className="mt-6 w-full pt-4 border-t border-gray-100 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            Real-time Phishing Detection
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            Powered by Gemini AI
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
