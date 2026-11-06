const nextConfig = {
  ...(process.env.STATIC_EXPORT === 'true'
    ? { output: 'export', distDir: '.next-render', env: { NEXT_PUBLIC_API_URL: '' } }
    : {}),
};

export default nextConfig;
