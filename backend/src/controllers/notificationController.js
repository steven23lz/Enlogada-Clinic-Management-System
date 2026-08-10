const notificationService = require('../services/notificationService');

class NotificationController {
  async getMine(req, res, next) {
    try {
      const data = await notificationService.getMyNotifications(req.user.userId);
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async markRead(req, res, next) {
    try {
      const { id } = req.params;
      const notification = await notificationService.markAsRead(id, req.user.userId);
      return res.status(200).json({
        status: 'success',
        data: { notification }
      });
    } catch (err) {
      next(err);
    }
  }

  async markAllRead(req, res, next) {
    try {
      await notificationService.markAllAsRead(req.user.userId);
      return res.status(200).json({
        status: 'success',
        message: 'All notifications marked as read.'
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new NotificationController();
