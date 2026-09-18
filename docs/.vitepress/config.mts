import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'SovereignS3nc',
  description: 'Offline-First, End-to-End Encrypted Data Storage Library for S3 and WebRTC',
  cleanUrls: true,
  themeConfig: {
    siteTitle: 'SovereignS3nc',
    nav: [
      { text: 'Guide', link: '/module-tutorial' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Comparison', link: '/comparison' },
      { text: 'API Reference', link: '/api' },
      { text: 'React Hooks', link: '/react' },
      {
        text: 'Deployments',
        items: [
          { text: 'Overview', link: '/deployment' },
          { text: 'AWS S3', link: '/aws' },
          { text: 'Oracle OCI', link: '/oci' },
          { text: 'RustFS (Local)', link: '/rustfs' },
          { text: 'WebRTC P2P', link: '/webrtc' },
          { text: 'PeerJS Broker', link: '/peerjs' },
        ]
      },
      { text: 'Interactive Demos', link: 'https://tonym128.github.io/SovereignS3nc/' }
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Overview & Philosophy', link: '/' },
          { text: 'Why SovereignS3nc? (Comparison)', link: '/comparison' },
          { text: 'Architecture & Internals', link: '/architecture' },
          { text: 'Data Model & Schemas', link: '/data-model' },
          { text: 'Security & Cryptography', link: '/security' },
        ]
      },
      {
        text: 'Developer Guide',
        items: [
          { text: 'Building Modules', link: '/module-tutorial' },
          { text: 'API Reference', link: '/api' },
          { text: 'React Hooks (@sovereigns3nc/react)', link: '/react' },
          { text: 'AI Agent / Gemini Skill', link: '/gemini-skill' },
        ]
      },
      {
        text: 'Deployments & Storage Adapters',
        items: [
          { text: 'Deployment Overview', link: '/deployment' },
          { text: 'AWS S3 Configuration', link: '/aws' },
          { text: 'Oracle Cloud (OCI)', link: '/oci' },
          { text: 'RustFS Local S3', link: '/rustfs' },
          { text: 'WebRTC Mesh Gossip', link: '/webrtc' },
          { text: 'PeerJS Cloud Pairing', link: '/peerjs' },
        ]
      }
    ],
    search: {
      provider: 'local'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/tonym128/SovereignS3nc' }
    ],
    footer: {
      message: 'Released under the ISC License.',
      copyright: 'Copyright © 2026 SovereignS3nc Authors'
    }
  }
});
