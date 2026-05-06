import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-noto)', 'system-ui', 'sans-serif'],
      },
      colors: {
        accent: {
          DEFAULT: '#e03131',
          hover:   '#c92a2a',
          dim:     'rgba(224,49,49,0.12)',
        },
      },
    },
  },
  plugins: [],
}

export default config
