const istHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23',
});
const istYear = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', year: 'numeric',
});

export function studentGreetingAt(date) {
  const hour = Number(istHour.format(date));
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export function studentYearAt(date) {
  return istYear.format(date);
}

// Reject protocol-relative, local-file, cleartext and malformed URLs. A rooted
// upload path always resolves against the configured BENIUS HTTPS origin.
export function resolveStudentPhotoUrl(photoUrl, domain) {
  if (typeof photoUrl !== 'string' || !photoUrl || /[\s\\\u0000-\u001f\u007f]/.test(photoUrl)) return null;
  try {
    if (photoUrl.startsWith('/uploads/') && domain) {
      const origin = new URL(`https://${domain}/`);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/'
        || origin.search || origin.hash) return null;
      const image = new URL(photoUrl, origin);
      return image.origin === origin.origin && image.pathname.startsWith('/uploads/') ? image.href : null;
    }
    if (!photoUrl.startsWith('https://')) return null;
    const image = new URL(photoUrl);
    return image.protocol === 'https:' && image.hostname && !image.username && !image.password ? image.href : null;
  } catch {
    return null;
  }
}