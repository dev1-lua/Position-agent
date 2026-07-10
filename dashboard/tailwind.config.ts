import type { Config } from 'tailwindcss';

// Token names + scale mirror Sucafina/dashboard-v2 (the desk's other Lua
// frontend) so both apps read as one product family: 13px Inter, true-neutral
// grays, one indigo accent, hairline borders, 8px cards / 4px controls.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      },
      borderRadius: { lg: 'var(--radius)', md: '6px', sm: '4px' },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      fontSize: { '2xs': ['10px', '14px'], xs: ['11px', '16px'], sm: ['13px', '18px'], base: ['13px', '18px'] },
      // Twenty's BOX_SHADOW_LIGHT.light, scaled down a hair: shadows whisper.
      boxShadow: {
        panel: '0px 2px 4px 0px rgba(0,0,0,0.04), 0px 0px 4px 0px rgba(0,0,0,0.06)',
        btn: '0px 1px 2px 0px rgba(0,0,0,0.04)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
