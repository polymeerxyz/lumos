// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const lightCodeTheme = require("prism-react-renderer/themes/github")
const darkCodeTheme = require("prism-react-renderer/themes/dracula")
const webpack = require("webpack")
const versioningBranchs = require("./versioning-branches")

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Lumos",
  url: "https://lumos-website.vercel.app",
  baseUrl: "/",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  // TODO waiting for a favicon
  // favicon: "img/favicon.ico",

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "ckb-js", // Usually your GitHub org/user name.
  projectName: "lumos", // Usually your repo name.

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        pages: {
          routeBasePath: "pages",
        },
        docs: {
          sidebarPath: require.resolve("./sidebars.js"),
          routeBasePath: "/",
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: "https://github.com/ckb-js/lumos/tree/develop/website",
        },
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      }),
    ],
  ],

  plugins: [
    [
      "@docusaurus/plugin-content-docs",
      {
        id: "tools",
        path: "tools",
        routeBasePath: "tools",
        sidebarPath: require.resolve("./sidebars.js"),
      },
    ],
    () => ({
      name: "node-polyfill",
      configureWebpack() {
        return {
          module: {
            rules: [{ test: /\.m?js/, resolve: { fullySpecified: false } }],
          },
          resolve: {
            fallback: {
              crypto: require.resolve("crypto-browserify"),
              buffer: require.resolve("buffer/"),
              path: false,
              fs: false,
              stream: false,
            },
          },
          plugins: [
            new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }),
            new webpack.ProvidePlugin({ process: "process/browser" }),
          ],
        }
      },
    }),
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: "Lumos",

        items: [
          {
            type: "doc",
            docId: "intro",
            position: "left",
            label: "Docs",
          },
          {
            to: "/tools/address-conversion",
            label: "Tools",
            position: "left",
          },
          // { to: "/blog", label: "Blog", position: "left" },
          {
            label: "API",
            position: "left",
            target: "_blank",
            items: [...versioningBranchs],
          },
          {
            href: "https://github.com/ckb-js/lumos",
            label: "GitHub",
            position: "right",
          },
        ],
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
        additionalLanguages: ["diff"],
      },
    }),
}

module.exports = config
