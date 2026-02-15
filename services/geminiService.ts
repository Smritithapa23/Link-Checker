
// import { GoogleGenAI, Type } from "@google/genai";
// import { SafetyVerdict, VerificationResult } from "../types";

// export const verifyUrlWithAI = async (url: string): Promise<VerificationResult> => {
//   try {
//     // Initialize GoogleGenAI right before the call to ensure the latest configuration/key is used
//     const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
//     // Using gemini-3-pro-preview for complex security reasoning (phishing, malware detection) as it involves high-reasoning tasks.
//     const response = await ai.models.generateContent({
//       model: "gemini-3-pro-preview",
//       contents: `Analyze this URL for security risks (phishing, malware, deceptive intent): ${url}. Be critical. Return a JSON verdict.`,
//       config: {
//         responseMimeType: "application/json",
//         responseSchema: {
//           type: Type.OBJECT,
//           properties: {
//             verdict: {
//               type: Type.STRING,
//               description: "Must be one of: SAFE, DANGER, SUSPICIOUS",
//             },
//             reason: {
//               type: Type.STRING,
//               description: "A short, one-sentence explanation for the verdict.",
//             },
//           },
//           required: ["verdict", "reason"],
//         },
//       },
//     });

//     const data = JSON.parse(response.text || '{}');
    
//     return {
//       url,
//       verdict: data.verdict as SafetyVerdict || SafetyVerdict.UNKNOWN,
//       reason: data.reason || "Unable to determine safety.",
//       timestamp: Date.now(),
//     };
//   } catch (error) {
//     console.error("Gemini Verification Error:", error);
//     return {
//       url,
//       verdict: SafetyVerdict.UNKNOWN,
//       reason: "Error communicating with the security brain.",
//       timestamp: Date.now(),
//     };
//   }
// };
import { SafetyVerdict, VerificationResult } from "../types";

const BACKEND_URLS = [
  'http://127.0.0.1:8000/analyze',
  'http://localhost:8000/analyze',
];
const BACKEND_TIMEOUT_MS = 8000;

const fetchWithTimeout = async (endpoint: string, url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
};

export const verifyUrlWithAI = async (url: string): Promise<VerificationResult> => {
  let lastError: unknown = null;

  try {
    for (const endpoint of BACKEND_URLS) {
      try {
        const response = await fetchWithTimeout(endpoint, url);

        if (!response.ok) {
          throw new Error(`Backend responded with status: ${response.status}`);
        }

        const data = await response.json();
        return {
          url,
          verdict: data.verdict as SafetyVerdict || SafetyVerdict.UNKNOWN,
          reason: data.reason || "Unable to determine safety.",
          timestamp: Date.now(),
        };
      } catch (error) {
        lastError = error;
      }
    }
  } catch (error) {
    lastError = error;
  }

  console.error("Shield Bridge Error:", lastError);
  return {
    url,
    verdict: SafetyVerdict.UNKNOWN,
    reason: `Backend timeout/unreachable (${BACKEND_TIMEOUT_MS / 1000}s). Start: uvicorn main:app --reload --host 127.0.0.1 --port 8000`,
    timestamp: Date.now(),
  };
};
