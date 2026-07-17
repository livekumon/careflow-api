function defaultRbac() {
  return {
    roles: [
      { key: "receptionist", name: "Receptionist", system: true },
      { key: "doctor", name: "Doctor", system: true },
      { key: "patient", name: "Patient", system: true },
      { key: "admin", name: "Clinic Admin", system: true },
    ],
    pages: [
      { key: "reception", name: "Front Desk", desc: "Queue calls & check-ins", enabled: true },
      { key: "doctor", name: "Doctor Console", desc: "Consult flow & up next", enabled: true },
      { key: "patient", name: "Patient Visit", desc: "QR check-in & live position", enabled: true },
      { key: "admin", name: "Clinic Admin", desc: "RBAC & tenant settings", enabled: true },
    ],
    pageAccess: {
      reception: { receptionist: true, doctor: false, patient: false, admin: true },
      doctor: { receptionist: false, doctor: true, patient: false, admin: true },
      patient: { receptionist: true, doctor: true, patient: true, admin: true },
      admin: { receptionist: false, doctor: false, patient: false, admin: true },
    },
    actions: [
      {
        key: "call_next",
        label: "Call / advance next patient",
        page: "reception",
        roles: { receptionist: true, doctor: false, patient: false, admin: true },
      },
      {
        key: "add_patient",
        label: "Add patient manually",
        page: "reception",
        roles: { receptionist: true, doctor: false, patient: false, admin: true },
      },
      {
        key: "qr_checkin",
        label: "Simulate / accept QR check-in",
        page: "reception",
        roles: { receptionist: true, doctor: false, patient: false, admin: true },
      },
      {
        key: "mark_noshow",
        label: "Mark no-show",
        page: "reception",
        roles: { receptionist: true, doctor: false, patient: false, admin: true },
      },
      {
        key: "complete_consult",
        label: "Complete consult & call next",
        page: "doctor",
        roles: { receptionist: false, doctor: true, patient: false, admin: true },
      },
      {
        key: "patient_cancel",
        label: "Cancel own check-in",
        page: "patient",
        roles: { receptionist: false, doctor: false, patient: true, admin: true },
      },
      {
        key: "manage_rbac",
        label: "Edit RBAC matrix",
        page: "admin",
        roles: { receptionist: false, doctor: false, patient: false, admin: true },
      },
    ],
  };
}

function serializeRbac(doc) {
  return {
    clinicId: String(doc.clinicId),
    roles: doc.roles,
    pages: doc.pages,
    pageAccess: doc.pageAccess || {},
    actions: (doc.actions || []).map((a) => ({
      key: a.key,
      label: a.label,
      page: a.page,
      roles: a.roles || {},
    })),
    updatedAt: doc.updatedAt,
  };
}

module.exports = { defaultRbac, serializeRbac };
