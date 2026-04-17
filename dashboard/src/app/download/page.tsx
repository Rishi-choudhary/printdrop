'use client';

import { Download, Monitor, Apple, Terminal, CheckCircle2 } from 'lucide-react';
import { Navbar } from '@/components/navbar';
import { useAuth } from '@/lib/auth';

export default function DownloadPage() {
  const { user } = useAuth();

  const detectOS = () => {
    if (typeof navigator === 'undefined') return 'windows';
    const ua = navigator.userAgent;
    if (ua.includes('Win')) return 'windows';
    if (ua.includes('Mac')) return 'macos';
    return 'linux';
  };

  const os = detectOS();

  const platforms = [
    {
      id: 'windows',
      name: 'Windows',
      icon: <Monitor className="w-6 h-6" />,
      file: 'PrintDrop-Agent-Setup.exe',
      ext: '.exe',
      instructions: 'Run the installer. A desktop shortcut will be created automatically.',
    },
    {
      id: 'macos',
      name: 'macOS',
      icon: <Apple className="w-6 h-6" />,
      file: 'PrintDrop-Agent.dmg',
      ext: '.dmg',
      instructions: 'Open the .dmg and drag PrintDrop Agent to your Applications folder.',
    },
    {
      id: 'linux',
      name: 'Linux',
      icon: <Terminal className="w-6 h-6" />,
      file: 'PrintDrop-Agent.AppImage',
      ext: '.AppImage',
      instructions: 'Make the file executable (chmod +x) and double-click to run.',
    },
  ];

  const primary = platforms.find((p) => p.id === os) || platforms[0];
  const others = platforms.filter((p) => p.id !== os);

  return (
    <div className="min-h-screen bg-gray-50">
      {user && <Navbar />}

      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <Download className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Download PrintDrop Agent</h1>
          <p className="text-gray-500 mt-2">
            Install on the computer connected to your printer
          </p>
        </div>

        {/* Primary download */}
        <a
          href={`/downloads/${primary.file}`}
          className="block bg-white border-2 border-blue-200 rounded-xl p-6 hover:bg-blue-50 transition-colors mb-4"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
              {primary.icon}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-gray-900 text-lg">{primary.name}</div>
              <div className="text-sm text-gray-500">Recommended for your system</div>
            </div>
            <Download className="w-5 h-5 text-blue-600" />
          </div>
        </a>

        {/* Other platforms */}
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-8">
          {others.map((p) => (
            <a
              key={p.id}
              href={`/downloads/${p.file}`}
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors"
            >
              <div className="text-gray-400">{p.icon}</div>
              <div className="flex-1">
                <div className="font-medium text-gray-700 text-sm">{p.name}</div>
                <div className="text-xs text-gray-400">{p.ext}</div>
              </div>
              <Download className="w-4 h-4 text-gray-300" />
            </a>
          ))}
        </div>

        {/* Quick setup guide */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Quick Setup</h2>
          <ol className="space-y-3">
            {[
              'Download and install the agent app',
              'Open it — the setup wizard will appear',
              'Paste your Agent Key (from Dashboard > Settings)',
              'Select your printer(s)',
              'Done! Jobs will print automatically',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </span>
                <span className="text-gray-600 pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
