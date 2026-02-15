
import React, { useEffect, useState } from 'react';
import { SafetyVerdict, VerificationResult } from '../types';

interface ShieldNotificationProps {
  result: VerificationResult | null;
  isLoading: boolean;
  onClose: () => void;
}

const ShieldNotification: React.FC<ShieldNotificationProps> = ({ result, isLoading, onClose }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isLoading || result) {
      setVisible(true);
      if (result) {
        const timer = setTimeout(() => {
          setVisible(false);
          setTimeout(onClose, 500);
        }, 8000);
        return () => clearTimeout(timer);
      }
    }
  }, [isLoading, result, onClose]);

  if (!visible && !isLoading) return null;

  const getVerdictStyles = () => {
    switch (result?.verdict) {
      case SafetyVerdict.SAFE:
        return {
          bg: 'bg-green-50',
          border: 'border-green-500',
          text: 'text-green-800',
          icon: '✅',
          label: 'Safe to proceed'
        };
      case SafetyVerdict.DANGER:
        return {
          bg: 'bg-red-50',
          border: 'border-red-500',
          text: 'text-red-800',
          icon: '🛑',
          label: 'Danger Detected'
        };
      case SafetyVerdict.SUSPICIOUS:
        return {
          bg: 'bg-yellow-50',
          border: 'border-yellow-500',
          text: 'text-yellow-800',
          icon: '⚠️',
          label: 'Caution Recommended'
        };
      default:
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-500',
          text: 'text-blue-800',
          icon: 'ℹ️',
          label: 'Verification Status'
        };
    }
  };

  const styles = getVerdictStyles();

  return (
    <div className={`pointer-events-auto fixed top-4 right-4 w-80 transform transition-all duration-500 ease-in-out ${visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}>
      <div className={`${isLoading ? 'bg-white' : styles.bg} border-l-4 ${isLoading ? 'border-blue-500' : styles.border} shadow-2xl rounded-lg p-4 flex flex-col gap-2`}>
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <span className="font-bold text-blue-600">LinkClick</span>
            {isLoading && (
              <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            )}
          </div>
          <button onClick={() => setVisible(false)} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="py-2">
            <p className="text-sm text-gray-600 animate-pulse">Scanning link with Gemini brain...</p>
          </div>
        ) : (
          <div className="py-1">
            <h3 className={`font-bold text-sm ${styles.text} flex items-center gap-2`}>
              <span>{styles.icon}</span>
              {styles.label}
            </h3>
            <p className="text-xs text-gray-700 mt-1 leading-relaxed">
              {result?.reason}
            </p>
            <div className="mt-2 text-[10px] text-gray-400 break-all font-mono opacity-60">
              {result?.url.substring(0, 50)}...
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShieldNotification;
