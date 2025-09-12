const express = require('express');
const router = express.Router();
const EmailRegistrationService = require('../services/emailRegistrationService');

const emailRegistrationService = new EmailRegistrationService();

// Register a new email with source URL
router.post('/register', async (req, res) => {
    try {
        const { email, sourceUrl, description } = req.body;

        if (!email || !sourceUrl) {
            return res.status(400).json({ error: 'Email và source URL là bắt buộc' });
        }

        const result = await emailRegistrationService.registerEmail(email, sourceUrl, description);
        res.json({ message: 'Đăng ký email thành công', registration: result });
    } catch (error) {
        console.error('Error in email registration:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all registered emails
router.get('/list', async (req, res) => {
    try {
        const registrations = await emailRegistrationService.getRegistrations();
        res.json(registrations);
    } catch (error) {
        console.error('Error getting email registrations:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete an email registration
router.delete('/:email', async (req, res) => {
    try {
        const { email } = req.params;
        await emailRegistrationService.deleteRegistration(email);
        res.json({ message: 'Xóa email thành công' });
    } catch (error) {
        console.error('Error deleting email registration:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update an email registration
router.put('/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { sourceUrl, description } = req.body;

        if (!sourceUrl) {
            return res.status(400).json({ error: 'Source URL là bắt buộc' });
        }

        const result = await emailRegistrationService.updateRegistration(email, sourceUrl, description);
        res.json({ message: 'Cập nhật email thành công', registration: result });
    } catch (error) {
        console.error('Error updating email registration:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get registration by email
router.get('/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const registration = await emailRegistrationService.getRegistrationByEmail(email);

        if (!registration) {
            return res.status(404).json({ error: 'Email không tìm thấy' });
        }

        res.json(registration);
    } catch (error) {
        console.error('Error getting email registration:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
