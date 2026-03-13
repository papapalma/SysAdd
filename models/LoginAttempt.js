import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

const LoginAttempt = sequelize.define('LoginAttempt', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { isEmail: true }
  },
  ipAddress: {
    type: DataTypes.STRING,
    allowNull: false
  },
  userAgent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  success: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  failureReason: {
    type: DataTypes.STRING,
    allowNull: true
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  blocked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'login_attempts',
  timestamps: true,
  indexes: [
    { fields: ['email'] },
    { fields: ['ipAddress'] },
    { fields: ['timestamp'] },
    { fields: ['email', 'timestamp'] },
    { fields: ['ipAddress', 'timestamp'] }
  ]
});

export default LoginAttempt;
