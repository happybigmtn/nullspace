import React from 'react';

const MaintenancePage = () => {
  const handleLogoClick = () => {
    window.open('https://x.com/commonwarexyz', '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 h-dvh w-screen overflow-hidden liquid-shell font-sans flex items-center justify-center p-6">
      <div
        className="max-w-md w-full liquid-card liquid-sheen p-10 flex flex-col items-center text-center gap-8 animate-scale-in group cursor-pointer"
        onClick={handleLogoClick}
      >
        {/* Animated Floating Icon */}
        <div className="relative animate-float">
            <div className="w-24 h-24 rounded-[32px] bg-action-primary flex items-center justify-center text-white shadow-lg shadow-action-primary/20 rotate-3 group-hover:rotate-6 transition-transform">
                <span className="text-4xl font-light">!</span>
            </div>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-12 h-2 bg-black/5 blur-md rounded-full" />
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-semibold text-ns-muted tracking-[0.4em] uppercase">System Status</span>
          <h1 className="text-2xl font-semibold text-ns tracking-tight font-display leading-tight text-balance">
            Undergoing Maintenance.
          </h1>
          <p className="text-[11px] text-ns-muted leading-relaxed px-4">
            We're enhancing the Nullspace experience. Please check back shortly for the updated interface.
          </p>
        </div>

        <div className="w-full h-px bg-black/10 dark:bg-white/10" />

        <div className="flex flex-col items-center gap-4">
            <span className="text-[10px] font-semibold text-ns-muted uppercase tracking-widest">Stay Connected</span>
            <div className="px-6 py-3 rounded-full liquid-chip text-ns text-[10px] uppercase tracking-[0.28em] shadow-soft group-hover:scale-105 active:scale-95 transition-all">
                @commonwarexyz
            </div>
        </div>
      </div>
    </div>
  );
};

export default MaintenancePage;
