document.addEventListener('DOMContentLoaded', () => {
    
    // 0. INJECT FAVICON
    const setFavicon = () => {
        let link = document.querySelector("link[rel~='icon']");
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        link.href = './img/logo.png'; 
    };
    setFavicon();

    // 1. INJECT NAVIGATION
    const navContainer = document.getElementById('nav-container');
    if(navContainer) {
        navContainer.innerHTML = `
        <nav class="fixed top-0 left-0 w-full z-50 transition-all duration-300 bg-neutral-950/80 backdrop-blur-md border-b border-white/5">
            <div class="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between relative z-50">
                
                <a href="./index.html" class="text-xl font-display font-bold uppercase tracking-[0.25em] text-white hover:text-red-600 transition-colors">
                    Staus<span class="text-red-800">.</span>
                </a>

                <div class="flex items-center gap-6 md:gap-8">
                    <a href="./index.html" class="text-[10px] md:text-xs font-display uppercase tracking-[0.2em] text-neutral-400 hover:text-white transition-colors">Book</a>
                    <a href="./membership.html" class="text-[10px] md:text-xs font-display uppercase tracking-[0.2em] text-red-500 hover:text-red-400 transition-colors">Membership</a>
                </div>

            </div>
        </nav>
        `;
    }

    // 2. INJECT FOOTER
    const footerContainer = document.getElementById('footer-container');
    if(footerContainer) {
        footerContainer.innerHTML = `
        <footer class="bg-neutral-950 border-t border-white/5 py-8 px-6 mt-auto">
            <div class="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
                <p class="text-neutral-600 text-xs font-mono uppercase tracking-widest">© ${new Date().getFullYear()} Michael Staus</p>

                <a href="https://blazedigitaldesign.com" target="_blank" class="flex items-center gap-2 text-[10px] font-mono text-neutral-700 hover:text-neutral-400 transition-colors uppercase tracking-widest">
                    Built by Blaze Digital
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 fill-current text-neutral-800" viewBox="0 0 384 512"><path d="M0 256L28.5 28c2-16 15.6-28 31.8-28H228.9c15 0 27.1 12.1 27.1 27.1c0 3.2-.6 6.5-1.7 9.5L208 160H347.3c20.2 0 36.7 16.4 36.7 36.7c0 7.4-2.2 14.6-6.4 20.7l-192.2 281c-5.9 8.6-15.6 13.7-25.9 13.7h-2.9c-15.7 0-28.5-12.8-28.5-28.5c0-2.3 .3-4.6 .9-6.9L176 288H32c-17.7 0-32-14.3-32-32z"/></svg>
                </a>
            </div>
        </footer>
        `;
    }
});
