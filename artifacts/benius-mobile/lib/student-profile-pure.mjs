/** Prefill the edit screen using the saved draft before the live student record. */
export function profileForm(student, profile) {
  return {
    fullName: profile?.fullName || student.name || '',
    rollNo: profile?.rollNo || (student.rollNumber == null ? '' : String(student.rollNumber)),
    fatherName: profile?.fatherName || student.fatherName || '',
    motherName: profile?.motherName || student.motherName || '',
    presentAddress: profile?.presentAddress || student.address || '',
    aadharNumber: profile?.aadharNumber || student.aadharNumber || '',
    gender: profile?.gender || student.gender || '',
    phone: profile?.phone || student.phone || '',
    email: profile?.email || student.email || '',
    dob: profile?.dob || student.dob || '',
    enrollmentDate: profile?.enrollmentDate || student.enrollmentDate || '',
    guardianName: profile?.guardianName || student.guardianName || '',
    bloodGroup: profile?.bloodGroup || student.bloodGroup || '',
  };
}

// Use the selected edited image format; never claim a HEIC/PNG contains JPEG bytes.
export function profilePhotoPart(asset) {
  const mimeByExtension = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const extension = asset.uri?.split(/[?#]/, 1)[0]?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const type = extension && mimeByExtension[extension];
  if (!type || (asset.mimeType && asset.mimeType.toLowerCase() !== type)) return null;
  return { uri: asset.uri, name: `profile.${extension === 'jpg' ? 'jpg' : extension}`, type };
}