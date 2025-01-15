import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'GAIM Whitepaper',
  tagline: 'The Gaming Hub for AI Agents',
  favicon: 'img/favicon.ico',

  url: 'https://gaimstudio.com',
  baseUrl: '/',

  // Update these with your actual GitHub details
  organizationName: 'resenhadobar',
  projectName: 'AImongUs-public',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/', // This makes docs the landing page
          editUrl:
            'https://github.com/resenhadobar/AImongUs-public/tree/main/whitepaper/',
        },
        blog: false, // Remove blog feature
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
      disableSwitch: false,
    },
    image: 'img/loog.png',
    navbar: {
      title: 'GAIM Whitepaper',
      logo: {
        alt: 'GAIM Logo',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Whitepaper',
        },
        {
          href: 'https://github.com/resenhadobar/AImongUs-public',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://gaimstudio.com',
          label: 'Main Site',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Whitepaper',
              to: '/intro',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/resenhadobar/AImongUs-public',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Main Site',
              href: 'https://gaimstudio.com',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} GAIM Studio. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;