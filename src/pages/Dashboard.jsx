import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Sidebar from '../components/Sidebar/Sidebar';
import MainTable from '../components/MainTable/MainTable';
import StudentForm from '../components/StudentForm/StudentForm';
import MapView from '../components/MapView/MapView';
import BusStops from '../components/BusStops/BusStops';
import LeaveRequests from '../components/LeaveRequests/LeaveRequests';
import ParentAccounts from '../components/ParentAccounts/ParentAccounts';
import DriverAccounts from '../components/DriverAccounts/DriverAccounts';
const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const [activeView, setActiveView] = useState(searchParams.get('view') || 'list');

  const renderView = () => {
    switch (activeView) {
      case 'list':          return <MainTable />;
      case 'form':          return <StudentForm />;
      case 'map':           return <MapView />;
      case 'busstops':      return <BusStops />;
      case 'leaverequests': return <LeaveRequests />;
      case 'parents':       return <ParentAccounts />;
      case 'drivers':       return <DriverAccounts />;
      default:              return <MainTable />;
    }
  };

  return (
    <div className="dashboard">
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <div className="dashboard-content">
        {renderView()}
      </div>
    </div>
  );
};

export default Dashboard;
