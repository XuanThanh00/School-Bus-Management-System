import React, { useState } from 'react';
import Sidebar from '../components/Sidebar/Sidebar';
import MainTable from '../components/MainTable/MainTable';
import StudentForm from '../components/StudentForm/StudentForm';
import MapView from '../components/MapView/MapView';

const Dashboard = () => {
  const [activeView, setActiveView] = useState('list'); // list, form, map

  return (
    <div className="dashboard">
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      
      <div className="dashboard-content">
        {activeView === 'list' && <MainTable />}
        {activeView === 'form' && <StudentForm />}
        {activeView === 'map' && <MapView />}
      </div>
    </div>
  );
};

export default Dashboard;
