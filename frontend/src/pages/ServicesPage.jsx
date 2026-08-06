import React from 'react';
import PublicHeader from '../components/PublicHeader';
import PublicFooter from '../components/PublicFooter';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Activity, Stethoscope, FileText, Heart, Zap, Dog } from 'lucide-react';

const ServicesPage = ({ onNavigate }) => {
  const serviceCategories = [
    {
      title: 'Laboratory',
      icon: Activity,
      iconBg: 'bg-emerald-50 text-emerald-600',
      items: [
        { name: 'Hematology', price: '250.00' },
        { name: 'Clinical Microscopy', price: '180.00' },
        { name: 'Clinical Chemistry', price: '1,320.00' },
        { name: 'Serology/Immunology', price: '680.00' },
        { name: 'Histopathology', price: '2,580.00' },
        { name: 'CBC', price: '350.00' },
        { name: 'Urinalysis', price: '150.00' },
        { name: 'Hepatitis B Screening', price: '280.00' },
        { name: 'Blood Typing', price: '180.00' },
      ]
    },
    {
      title: 'Ultrasound',
      icon: Stethoscope,
      iconBg: 'bg-[#769046]/10 text-[#769046]',
      items: [
        { name: 'Whole Abdomen', price: '1,500.00' },
        { name: 'Pelvic Ultrasound', price: '1,200.00' },
        { name: 'KUB-Prostate', price: '1,320.00' },
        { name: 'Thyroid, Liver & Kidneys', price: '1,450.00' },
        { name: 'Breast', price: '1,200.00' },
        { name: 'Transvaginal Reg (A)', price: '2,380.00' },
        { name: 'Transvaginal Reg (B)', price: '3,120.00' },
        { name: 'Bundle Package (B)', price: '2,550.00' },
      ]
    },
    {
      title: 'X-Ray',
      icon: FileText,
      iconBg: 'bg-indigo-50 text-indigo-600',
      items: [
        { name: 'Chest X-Ray (PA)', price: '450.00' },
        { name: 'Skull', price: '580.00' },
        { name: 'Extremity X-Ray', price: '380.00' },
        { name: 'Spine X-Ray', price: '750.00' },
        { name: 'Pelvic X-Ray', price: '520.00' },
      ]
    },
    {
      title: '2D Echo',
      icon: Heart,
      iconBg: 'bg-rose-50 text-rose-600',
      items: [
        { name: 'Plain 2D Echo with Doppler', price: '2,580.00' },
        { name: 'Pediatric 2D Echo', price: '3,080.00' },
      ]
    },
    {
      title: 'ECG',
      icon: Zap,
      iconBg: 'bg-amber-50 text-amber-600',
      items: [
        { name: '12 Lead ECG', price: '480.00' },
      ]
    },
    {
      title: 'Veterinary / Pets',
      icon: Dog,
      iconBg: 'bg-teal-50 text-teal-600',
      items: [
        { name: 'Pet Ultrasound', price: '680.00' },
        { name: 'Pet X-Ray', price: '580.00' },
        { name: 'Pet CBC', price: '450.00' },
      ]
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="services" onNavigate={onNavigate} />

      {/* Page Title Dark Header matching Image 4 */}
      <section className="bg-[#1e293b] text-white py-14 px-8 border-b border-gray-800">
        <div className="max-w-7xl mx-auto space-y-3">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Our Services</h1>
          <p className="text-gray-300 text-sm max-w-2xl leading-relaxed">
            Comprehensive medical and diagnostic services providing accurate results with state-of-the-art equipment.
          </p>
        </div>
      </section>

      {/* Services Grid Section */}
      <main className="flex-1 max-w-7xl mx-auto px-8 py-12 w-full space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {serviceCategories.map((cat, idx) => {
            const Icon = cat.icon;
            return (
              <Card key={idx} className="border-gray-100 shadow-sm rounded-2xl overflow-hidden bg-white hover:shadow-md transition-shadow">
                <CardHeader className="py-5 px-6 border-b border-gray-100 flex flex-row items-center space-x-3 space-y-0">
                  <div className={`p-2.5 rounded-xl ${cat.iconBg}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-lg font-bold text-gray-900">{cat.title}</CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-3">
                  {cat.items.map((item, i) => (
                    <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-gray-50 last:border-0">
                      <span className="text-gray-700 font-medium flex items-center space-x-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#769046]"></span>
                        <span>{item.name}</span>
                      </span>
                      <span className="font-bold text-gray-900">₱{item.price}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default ServicesPage;
