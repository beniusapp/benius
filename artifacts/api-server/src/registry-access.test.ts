import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import test from "node:test";
import {
  authenticateRegistryActorPassword,
  getRegistryAuditActor,
  registryAnyModuleAccessAllowed,
  registryModuleAccessAllowed,
  registrySubmoduleAccessAllowed,
} from "./registry-access";
import { storage } from "./storage";

test("registry access requires an exact parent grant and a positive Staff ID", () => {
  const supportStaff = {
    session: {
      userId: -7,
      staffId: 7,
      schoolId: 1,
      userRole: "support_staff",
      allowedModules: ["student-registry"],
    },
  } as any;

  assert.equal(registryModuleAccessAllowed(supportStaff, "student-registry"), true);
  assert.deepEqual(getRegistryAuditActor(supportStaff), { id: 7, role: "support_staff" });

  supportStaff.session.allowedModules = ["student-registry:view"];
  assert.equal(registryModuleAccessAllowed(supportStaff, "student-registry"), false);
  assert.equal(registryAnyModuleAccessAllowed(supportStaff, ["student-registry", "id-card-gen"]), false);

  supportStaff.session.allowedModules = ["id-card-gen"];
  assert.equal(registryAnyModuleAccessAllowed(supportStaff, ["student-registry", "id-card-gen"]), true);

  supportStaff.session.staffId = -7;
  assert.equal(registryModuleAccessAllowed(supportStaff, "id-card-gen"), false);
  assert.equal(getRegistryAuditActor(supportStaff), null);
});

test("registry mutations require an exact action child and its parent grant", () => {
  const req = {
    session: {
      userId: -7,
      staffId: 7,
      schoolId: 1,
      userRole: "support_staff",
      allowedModules: ["teacher-registry"],
    },
  } as any;

  assert.equal(registrySubmoduleAccessAllowed(req, "teacher-registry", "add"), false);
  req.session.allowedModules = ["teacher-registry:add"];
  assert.equal(registrySubmoduleAccessAllowed(req, "teacher-registry", "add"), false);
  req.session.allowedModules = ["teacher-registry", "teacher-registry:add"];
  assert.equal(registrySubmoduleAccessAllowed(req, "teacher-registry", "add"), true);
  assert.equal(registrySubmoduleAccessAllowed(req, "teacher-registry", "edit"), false);

  req.session.userRole = "admin";
  req.session.userId = 70;
  req.session.allowedModules = [];
  assert.equal(registrySubmoduleAccessAllowed(req, "teacher-registry", "delete"), true);
});

test("password confirmation checks the Staff account, never the negative compatibility userId", async (t) => {
  const originalGetStaff = storage.getNonTeachingStaffById;
  const originalGetUser = storage.getUserById;
  const staffLookups: number[] = [];
  const userLookups: number[] = [];
  const password = "registry-test-password";
  const passwordHash = await bcrypt.hash(password, 4);

  (storage as any).getNonTeachingStaffById = async (id: number) => {
    staffLookups.push(id);
    return {
      id,
      schoolId: 1,
      isActive: true,
      email: "staff@example.test",
      passwordHash,
    };
  };
  (storage as any).getUserById = async (id: number) => {
    userLookups.push(id);
    throw new Error("Support Staff password checks must not query the Admin users table");
  };
  t.after(() => {
    (storage as any).getNonTeachingStaffById = originalGetStaff;
    (storage as any).getUserById = originalGetUser;
  });

  const req = {
    session: {
      userId: -7,
      staffId: 7,
      schoolId: 1,
      userRole: "support_staff",
      allowedModules: ["teacher-registry"],
    },
  } as any;
  const actor = await authenticateRegistryActorPassword(req, password);

  assert.deepEqual(actor, {
    id: 7,
    role: "support_staff",
    email: "staff@example.test",
  });
  assert.deepEqual(staffLookups, [7]);
  assert.deepEqual(userLookups, []);
  assert.equal(await authenticateRegistryActorPassword(req, "wrong-password"), null);
  assert.deepEqual(userLookups, []);
});
