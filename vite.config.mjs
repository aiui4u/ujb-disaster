import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
export default defineConfig({base:'./',plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},css:{postcss:{plugins:[tailwind()]}},build:{outDir:'web',emptyOutDir:false}});
