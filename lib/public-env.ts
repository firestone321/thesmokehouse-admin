export const publicEnv = {
  webPushVapidPublicKey:
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? ""
};
