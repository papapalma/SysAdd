import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

// Simple key/value content store. Use key='site' for site-wide JSON content.
export const Content = sequelize.define('Content', {
  key: { type: DataTypes.STRING, allowNull: false },
  value: { type: DataTypes.TEXT }
});

export default Content;
