import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Action の受け入れ上限は既定 1MB。スマホの写真は軽く超えるので広げる。
    // （送る前にブラウザ側で縮めているので、ここまで来るのは普通ない保険）
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
