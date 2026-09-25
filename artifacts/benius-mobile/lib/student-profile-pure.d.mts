type ProfileField = 'fullName' | 'rollNo' | 'fatherName' | 'motherName' | 'presentAddress' |
  'aadharNumber' | 'gender' | 'phone' | 'dob' | 'enrollmentDate' | 'guardianName' | 'bloodGroup' | 'email';
type ProfileSource = Partial<Record<ProfileField, string | null>>;
type StudentSource = {
  name: string; rollNumber: number | null; fatherName: string | null; motherName: string | null;
  address: string | null; aadharNumber: string | null; gender: string | null; phone: string;
  dob: string; enrollmentDate: string | null; guardianName: string | null; bloodGroup: string | null; email: string | null;
};
export function profileForm(student: StudentSource, profile: ProfileSource | null): Record<ProfileField, string>;
export function profilePhotoPart(asset: { uri: string; mimeType?: string | null }): { uri: string; name: string; type: string } | null;