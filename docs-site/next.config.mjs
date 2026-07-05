import { createMDX } from 'fumadocs-mdx/next'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export → plain HTML/CSS/JS in ./out, so the Nimbus server can host it under docs.* with
  // no separate Node process. (No dynamic OG images / server search — search is a static index.)
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
}

const withMDX = createMDX()

export default withMDX(nextConfig)
