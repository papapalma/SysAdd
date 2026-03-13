import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

const Faq = sequelize.define('Faq', {
  question: { type: DataTypes.STRING, allowNull: false },
  answer: { type: DataTypes.TEXT, allowNull: false },
  // Store keywords as JSON array string in TEXT
  keywords: { type: DataTypes.TEXT, allowNull: true },
});

export default Faq;
