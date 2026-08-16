const patientService = require('../services/patientService');
const auditService = require('../services/auditService');

class PatientController {
  async addProfile(req, res, next) {
    try {
      const { patientTypeId, firstName, lastName, birthdate, sex, address, contactNumber, emergencyContact } = req.body;
      const isClient = req.user?.roles?.includes('Client');
      const linkedUserId = isClient ? req.user.userId : null;

      // Validations
      if (!patientTypeId || !firstName || !lastName || !birthdate || !sex) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient type, first name, last name, birthdate, and sex are required.'
        });
      }

      const patient = await patientService.addPatientProfile(linkedUserId, {
        patientTypeId,
        firstName,
        lastName,
        birthdate,
        sex,
        address,
        contactNumber,
        emergencyContact
      });

      return res.status(201).json({
        status: 'success',
        message: 'Patient profile created successfully.',
        data: { patient }
      });
    } catch (err) {
      next(err);
    }
  }

  async getMyProfiles(req, res, next) {
    try {
      const userId = req.user.userId;
      const patients = await patientService.getClientPatients(userId);

      return res.status(200).json({
        status: 'success',
        data: { patients }
      });
    } catch (err) {
      next(err);
    }
  }

  async getProfileById(req, res, next) {
    try {
      const { id } = req.params;
      const patient = await patientService.getPatientById(id, req.user);

      // Security Check: If client, verify patient belongs to them
      if (req.user.roles.includes('Client') && patient.user_id !== req.user.userId) {
        return res.status(403).json({
          status: 'error',
          message: 'Access forbidden. This profile does not belong to your account.'
        });
      }

      // Logged only for staff. A Client opening their own profile is not an access anyone will
      // ever investigate, and recording it would bury the entries that matter under routine
      // self-service traffic.
      if (!req.user.roles.includes('Client')) {
        await auditService.logPhiRead({
          actorId: req.user.userId,
          patientId: patient.id,
          resource: 'patient_record',
          description: `Viewed the record of ${patient.first_name} ${patient.last_name} (PT-${patient.id})`,
        });
      }

      return res.status(200).json({
        status: 'success',
        data: { patient }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const { id } = req.params;
      const { patientTypeId, firstName, lastName, birthdate, sex, address, contactNumber, emergencyContact } = req.body;

      if (!patientTypeId || !firstName || !lastName || !birthdate || !sex) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient type, first name, last name, birthdate, and sex are required.'
        });
      }

      // Check ownership if user is client
      const patient = await patientService.getPatientById(id, req.user);
      if (req.user.roles.includes('Client') && patient.user_id !== req.user.userId) {
        return res.status(403).json({
          status: 'error',
          message: 'Access forbidden. You do not own this profile.'
        });
      }

      const updated = await patientService.updatePatientProfile(id, {
        patientTypeId,
        firstName,
        lastName,
        birthdate,
        sex,
        address,
        contactNumber,
        emergencyContact
      }, req.user);

      return res.status(200).json({
        status: 'success',
        message: 'Patient profile updated successfully.',
        data: { patient: updated }
      });
    } catch (err) {
      next(err);
    }
  }

  async search(req, res, next) {
    try {
      const { q } = req.query;
      const patients = await patientService.searchPatients(q, req.user);
      // The UI says which departments a scoped result set was confined to, so a short list reads
      // as "your department" rather than "the clinic has no such patient".
      return res.status(200).json({
        status: 'success',
        data: { patients, departmentScope: patientService.departmentScopeFor(req.user) }
      });
    } catch (err) {
      next(err);
    }
  }

  async getTypes(req, res, next) {
    try {
      const types = await patientService.getPatientTypes();
      return res.status(200).json({
        status: 'success',
        data: { patientTypes: types }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PatientController();
