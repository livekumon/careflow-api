function serializeQueue(queue, doctor, clinic, extras = {}) {
  const scope = queue.scope || (queue.doctorId ? "doctor" : "clinic");
  return {
    id: String(queue._id),
    code: queue.code,
    active: queue.active,
    scope,
    clinic: clinic
      ? { id: String(clinic._id || clinic.id), slug: clinic.slug, name: clinic.name }
      : { id: String(queue.clinicId) },
    doctor:
      scope === "clinic"
        ? null
        : doctor
          ? {
              id: String(doctor._id || doctor.id),
              name: doctor.name,
              specialty: doctor.specialty,
              key: doctor.key,
            }
          : queue.doctorId
            ? { id: String(queue.doctorId) }
            : null,
    updatedAt: queue.updatedAt,
    ...extras,
  };
}

module.exports = { serializeQueue };
