import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

const Log = sequelize.define('Log', {
  level: { type: DataTypes.STRING, allowNull: false, defaultValue: 'INFO' },
  message: { type: DataTypes.STRING, allowNull: false },
  meta: { type: DataTypes.TEXT },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
  timestamps: false
});

export default Log;