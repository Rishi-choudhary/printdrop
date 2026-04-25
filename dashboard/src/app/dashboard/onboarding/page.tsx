'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import {
  Key, Download, Monitor, Printer, CheckCircle2, Copy, Check,
  ArrowRight, ArrowLeft, Loader2, AlertCircle, ExternalLink,
} from 'lucide-react';
import { encodePathSegment } from '@/lib/security';

type Step = 1 | 2 | 3 | 4 | 5;

export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [agentKey, setAgentKey] = useState('');
  const [hasAgentKey, setHasAgentKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shopId, setShopId] = useState('');
  const [testJobId, setTestJobId] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'polling' | 'success' | 'failed'>('idle');
  const [error, setError] = useState('');

  // Load shop data to get agent key
  useEffect(() => {
    if (!user?.shop?.id) return;
    setShopId(user.shop.id);
    api.get(`/shops/${encodePathSegment(user.shop.id)}`)
      .then((shop: any) => {
        setHasAgentKey(Boolean(shop.hasAgentKey));
      })
      .catch(() => {});
  }, [user?.shop?.id]);

  const copyKey = useCallback(() => {
    navigator.clipboard.writeText(agentKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [agentKey]);

  const generateKey = async () => {
    if (!shopId) return;
    try {
      const res = await api.post(`/shops/${encodePathSegment(shopId)}/agent-key`, {});
      setAgentKey(res.agentKey);
      setHasAgentKey(true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const sendTestPrint = async () => {
    if (!shopId) return;
    setTestStatus('sending');
    setError('');
    try {
      const res = await api.post(`/shops/${encodePathSegment(shopId)}/test-print`, {});
      setTestJobId(res.job.id);
      setTestStatus('polling');
    } catch (err: any) {
      setError(err.message || 'Failed to send test print');
      setTestStatus('failed');
    }
  };

  // Poll test job status
  useEffect(() => {
    if (testStatus !== 'polling' || !testJobId) return;

    let attempts = 0;
    const maxAttempts = 30; // 60 seconds

    const interval = setInterval(async () => {
      attempts++;
      try {
        const job = await api.get(`/jobs/${encodePathSegment(testJobId)}`);
        if (job.status === 'ready' || job.status === 'picked_up') {
          setTestStatus('success');
          clearInterval(interval);
        } else if (job.status === 'cancelled') {
          setTestStatus('failed');
          setError('Test print was cancelled. Check if the agent is running and printer is connected.');
          clearInterval(interval);
        }
      } catch {
        // ignore poll errors
      }

      if (attempts >= maxAttempts) {
        setTestStatus('failed');
        setError('Test print timed out. Make sure the PrintDrop Agent is running on your computer.');
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [testStatus, testJobId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    router.push('/login');
    return null;
  }

  const detectOS = () => {
    const ua = navigator.userAgent;
    if (ua.includes('Win')) return 'windows';
    if (ua.includes('Mac')) return 'macos';
    return 'linux';
  };

  const os = detectOS();

  const steps = [
    { num: 1, icon: Key, label: 'Agent Key' },
    { num: 2, icon: Download, label: 'Download' },
    { num: 3, icon: Monitor, label: 'Install' },
    { num: 4, icon: Printer, label: 'Test Print' },
    { num: 5, icon: CheckCircle2, label: 'Done' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Set Up Your Print Agent</h1>
          <p className="text-gray-500 mt-1">Follow these steps to start receiving print jobs</p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-1 mb-8">
          {steps.map((s, i) => (
            <div key={s.num} className="flex items-center">
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  step === s.num
                    ? 'bg-blue-600 text-white'
                    : step > s.num
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {step > s.num ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <s.icon className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`w-6 h-0.5 mx-1 ${step > s.num ? 'bg-green-300' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Step 1: Agent Key */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Your Agent Key</h2>
              <p className="text-gray-500 text-sm mb-4">
                This key connects the PrintDrop Agent on your computer to your shop. Copy it — you'll paste it during agent setup.
              </p>

              {agentKey ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono text-gray-800 break-all select-all">
                      {agentKey}
                    </code>
                    <button
                      onClick={copyKey}
                      className="flex-shrink-0 p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      title="Copy to clipboard"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  {copied && (
                    <p className="text-green-600 text-xs font-medium">Copied to clipboard!</p>
                  )}
                </div>
              ) : hasAgentKey ? (
                <div className="text-center py-6">
                  <p className="text-gray-500 text-sm mb-3">
                    An agent key already exists but cannot be shown again. Generate a new one to copy it.
                  </p>
                  <button
                    onClick={generateKey}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
                  >
                    Regenerate Agent Key
                  </button>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-gray-500 text-sm mb-3">No agent key generated yet</p>
                  <button
                    onClick={generateKey}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
                  >
                    Generate Agent Key
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Download */}
          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Download PrintDrop Agent</h2>
              <p className="text-gray-500 text-sm mb-6">
                Download and install the agent app on the computer connected to your printer.
              </p>

              <div className="space-y-3">
                <a
                  href={
                    os === 'windows'
                      ? '/downloads/PrintDrop-Agent-Setup.exe'
                      : os === 'macos'
                      ? '/downloads/PrintDrop-Agent.dmg'
                      : '/downloads/PrintDrop-Agent.AppImage'
                  }
                  className="flex items-center justify-between p-4 border-2 border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Download className="w-5 h-5 text-blue-600" />
                    <div>
                      <div className="font-medium text-gray-900">
                        {os === 'windows' ? 'Windows (.exe)' : os === 'macos' ? 'macOS (.dmg)' : 'Linux (.AppImage)'}
                      </div>
                      <div className="text-xs text-gray-500">Recommended for your system</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-blue-600" />
                </a>

                <details className="text-sm text-gray-500">
                  <summary className="cursor-pointer hover:text-gray-700">Other platforms</summary>
                  <div className="mt-2 space-y-2 pl-4">
                    {os !== 'windows' && (
                      <a href="/downloads/PrintDrop-Agent-Setup.exe" className="block text-blue-600 hover:underline">
                        Windows (.exe)
                      </a>
                    )}
                    {os !== 'macos' && (
                      <a href="/downloads/PrintDrop-Agent.dmg" className="block text-blue-600 hover:underline">
                        macOS (.dmg)
                      </a>
                    )}
                    {os !== 'linux' && (
                      <a href="/downloads/PrintDrop-Agent.AppImage" className="block text-blue-600 hover:underline">
                        Linux (.AppImage)
                      </a>
                    )}
                  </div>
                </details>
              </div>
            </div>
          )}

          {/* Step 3: Install & Connect */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Install & Connect</h2>
              <p className="text-gray-500 text-sm mb-6">
                Follow these simple steps to connect the agent to your shop.
              </p>

              <ol className="space-y-4">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">1</span>
                  <div>
                    <div className="font-medium text-gray-900">Install the app</div>
                    <div className="text-sm text-gray-500">
                      {os === 'windows'
                        ? 'Run the .exe installer and follow the prompts. A desktop shortcut will be created.'
                        : os === 'macos'
                        ? 'Open the .dmg file and drag PrintDrop Agent to Applications.'
                        : 'Make the AppImage executable and double-click to run.'}
                    </div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">2</span>
                  <div>
                    <div className="font-medium text-gray-900">Open PrintDrop Agent</div>
                    <div className="text-sm text-gray-500">
                      The setup wizard will appear. You'll see it in your system tray (bottom-right on Windows, top-right on macOS).
                    </div>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">3</span>
                  <div>
                    <div className="font-medium text-gray-900">Paste your Agent Key</div>
                    <div className="text-sm text-gray-500">
                      Paste the key from Step 1 into the agent. Click "Validate & Connect".
                    </div>
                    {agentKey && (
                      <button
                        onClick={copyKey}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md transition-colors"
                      >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? 'Copied!' : 'Copy key again'}
                      </button>
                    )}
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold">4</span>
                  <div>
                    <div className="font-medium text-gray-900">Select your printers</div>
                    <div className="text-sm text-gray-500">
                      The agent will detect your printers. Pick which one to use for B&W and which for color (optional).
                    </div>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {/* Step 4: Test Print */}
          {step === 4 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Test Print</h2>
              <p className="text-gray-500 text-sm mb-6">
                Make sure everything works. This will send a test page to your printer.
              </p>

              <div className="text-center py-4">
                {testStatus === 'idle' && (
                  <button
                    onClick={sendTestPrint}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg text-sm transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    Send Test Print
                  </button>
                )}

                {testStatus === 'sending' && (
                  <div className="flex items-center justify-center gap-2 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Sending test job...
                  </div>
                )}

                {testStatus === 'polling' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 text-blue-600">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Waiting for agent to print...
                    </div>
                    <p className="text-xs text-gray-400">
                      This can take up to 30 seconds. Make sure the agent is running.
                    </p>
                  </div>
                )}

                {testStatus === 'success' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 text-green-600">
                      <CheckCircle2 className="w-6 h-6" />
                      <span className="font-medium">Test print successful!</span>
                    </div>
                    <p className="text-sm text-gray-500">
                      Check your printer — a test page should have printed.
                    </p>
                  </div>
                )}

                {testStatus === 'failed' && (
                  <div className="space-y-3">
                    <button
                      onClick={() => {
                        setTestStatus('idle');
                        setError('');
                      }}
                      className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg text-sm transition-colors"
                    >
                      <Printer className="w-4 h-4" />
                      Try Again
                    </button>
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-400 text-center mt-4">
                You can skip this step and test later from Settings.
              </p>
            </div>
          )}

          {/* Step 5: Done */}
          {step === 5 && (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">You're All Set!</h2>
              <p className="text-gray-500 text-sm mb-6">
                Your shop is ready to receive print jobs. Customers can now send files via WhatsApp, Telegram, or the web app.
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => router.push('/dashboard')}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg text-sm transition-colors"
                >
                  Go to Dashboard
                </button>
                <button
                  onClick={() => router.push('/dashboard/settings')}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 px-4 rounded-lg text-sm transition-colors"
                >
                  Configure Rates & Hours
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-4">
          {step > 1 && step < 5 ? (
            <button
              onClick={() => setStep((step - 1) as Step)}
              className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 text-sm font-medium transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div />
          )}

          {step < 5 && (
            <button
              onClick={() => setStep((step + 1) as Step)}
              className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
            >
              {step === 4 ? 'Skip & Finish' : 'Next'}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
