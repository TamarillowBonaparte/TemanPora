const nextConfig = {
  ...(process.env.STATIC_EXPORT === 'true'
    ? { output: 'export', trailingSlash: true, distDir: '.next-render', env: { NEXT_PUBLIC_API_URL: '' } }
    : {}),
};

export default nextConfig;
