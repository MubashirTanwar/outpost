/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/openings", destination: "/courses", permanent: false }];
  },
};

export default nextConfig;
