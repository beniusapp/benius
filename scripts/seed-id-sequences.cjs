const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  // 1. Create the sequences table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS id_sequences (
      school_id    INTEGER NOT NULL,
      type         TEXT    NOT NULL,
      last_issued  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (school_id, type)
    )
  `);
  console.log('Table created / verified.');

  // 2. Get all schools
  const schools = (await pool.query('SELECT id, code FROM schools')).rows;

  for (const school of schools) {
    const sid = school.id;
    const code = school.code;

    // --- DTID: max across active teachers AND removed_teachers_log ---
    const teacherPrefix = code + '-T';
    const activeTeachers = (await pool.query(
      `SELECT digital_teacher_id FROM teachers WHERE school_id = $1 AND digital_teacher_id LIKE $2`,
      [sid, teacherPrefix + '%']
    )).rows;
    const removedTeachers = (await pool.query(
      `SELECT digital_teacher_id FROM removed_teachers_log WHERE school_id = $1 AND digital_teacher_id LIKE $2`,
      [sid, teacherPrefix + '%']
    )).rows;
    const allTeacherIds = [...activeTeachers, ...removedTeachers];
    let dtidMax = 0;
    for (const row of allTeacherIds) {
      const suffix = (row.digital_teacher_id || '').replace(teacherPrefix, '');
      const num = parseInt(suffix, 10);
      if (!isNaN(num) && num > dtidMax) dtidMax = num;
    }
    await pool.query(`
      INSERT INTO id_sequences (school_id, type, last_issued) VALUES ($1, 'dtid', $2)
      ON CONFLICT (school_id, type) DO UPDATE
        SET last_issued = GREATEST(id_sequences.last_issued, EXCLUDED.last_issued)
    `, [sid, dtidMax]);
    console.log(`DTID  school=${code} (id=${sid}) -> last_issued=${dtidMax}`);

    // --- DSID: max across active students ---
    const studentPrefix = code + '-';
    const activeStudents = (await pool.query(
      `SELECT digital_student_id FROM students WHERE school_id = $1 AND digital_student_id LIKE $2`,
      [sid, studentPrefix + '%']
    )).rows;
    let dsidMax = 0;
    for (const row of activeStudents) {
      const suffix = (row.digital_student_id || '').replace(studentPrefix, '');
      const num = parseInt(suffix, 10);
      if (!isNaN(num) && num > dsidMax) dsidMax = num;
    }
    await pool.query(`
      INSERT INTO id_sequences (school_id, type, last_issued) VALUES ($1, 'dsid', $2)
      ON CONFLICT (school_id, type) DO UPDATE
        SET last_issued = GREATEST(id_sequences.last_issued, EXCLUDED.last_issued)
    `, [sid, dsidMax]);
    console.log(`DSID  school=${code} (id=${sid}) -> last_issued=${dsidMax}`);
  }

  const final = (await pool.query('SELECT * FROM id_sequences ORDER BY school_id, type')).rows;
  console.log('\nFinal id_sequences table:');
  console.table(final);
  pool.end();
}

run().catch(e => { console.error('FAILED:', e.message); pool.end(); process.exit(1); });
